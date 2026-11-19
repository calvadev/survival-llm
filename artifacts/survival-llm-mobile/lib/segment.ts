/**
 * The pure part of the download engine: the segment scheduler.
 *
 * A large file is split into fixed-size chunks fetched over parallel HTTP
 * range requests and written straight to their offsets in the destination
 * file, so a multi-gigabyte model that crawls on one connection finishes
 * several times faster. Nothing here touches the network or the filesystem
 * directly — the chunk fetcher and the file sink are injected — which keeps
 * the scheduler testable on its own and lets lib/download.ts supply the React
 * Native pieces.
 *
 * The scheduler also owns the two behaviours that make a big download
 * survivable on a phone: a chunk that stops producing bytes is aborted and
 * retried (instead of hanging the whole download forever), and the set of
 * chunks already on disk is reported after each one so an interrupted
 * transfer resumes instead of starting over.
 */

export interface Chunk {
  index: number;
  /** Inclusive first byte of the chunk. */
  start: number;
  /** Inclusive last byte of the chunk. */
  end: number;
}

/** Somewhere chunks can be written at an absolute offset. */
export interface Sink {
  writeAt(offset: number, bytes: Uint8Array): Promise<void>;
}

export interface SegmentProgress {
  /** Bytes on disk so far, chunks resumed from an earlier attempt included. */
  written: number;
  total: number;
  /** Smoothed throughput in bytes per second; 0 until there is enough to measure. */
  speed: number;
  /** A short line for the UI about a stall or retry; absent when all is well. */
  note?: string;
}

export interface SegmentRun {
  url: string;
  size: number;
  sink: Sink;
  /** Chunk indexes already on disk from an earlier attempt. */
  done: Set<number>;
  fetchChunk: (chunk: Chunk, onBytes: (loaded: number) => void, signal?: AbortSignal) => Promise<Uint8Array>;
  onProgress: (p: SegmentProgress) => void;
  /** Called after each chunk lands, so a resume can be recorded. */
  onChunkDone?: (index: number, done: Set<number>) => void;
  signal?: AbortSignal;
  chunkBytes?: number;
  connections?: number;
  maxAttempts?: number;
  backoffMs?: number[];
  progressMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;
export const DEFAULT_CONNECTIONS = 4;

/** The chunk boundaries for a file of `size` bytes. */
export function planChunks(size: number, chunkBytes = DEFAULT_CHUNK_BYTES): Chunk[] {
  const chunks: Chunk[] = [];
  for (let start = 0, index = 0; start < size; start += chunkBytes, index++) {
    chunks.push({ index, start, end: Math.min(start + chunkBytes, size) - 1 });
  }
  return chunks;
}

export function chunkLength(chunk: Chunk): number {
  return chunk.end - chunk.start + 1;
}

/**
 * Pack the completed chunk indexes as a hex bitset: a 2 GB file in 4 MB chunks
 * is 512 chunks, so 64 characters — small enough to keep in AsyncStorage and
 * rewrite after every chunk.
 */
export function packDone(count: number, done: Set<number>): string {
  const bytes = new Uint8Array(Math.ceil(count / 8));
  for (const index of done) {
    if (index >= 0 && index < count) bytes[index >> 3] |= 1 << (index & 7);
  }
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

export function unpackDone(hex: string): Set<number> {
  const done = new Set<number>();
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16);
    if (!Number.isFinite(byte)) continue;
    for (let bit = 0; bit < 8; bit++) {
      if (byte & (1 << bit)) done.add((i / 2) * 8 + bit);
    }
  }
  return done;
}

/** Exponential moving average of throughput, in bytes per second. */
export class Speedometer {
  private readonly factor: number;
  private at = 0;
  private bytes = 0;
  private value = 0;

  constructor(factor = 0.35) {
    this.factor = factor;
  }

  update(now: number, bytes: number): number {
    if (!this.at) {
      this.at = now;
      this.bytes = bytes;
      return this.value;
    }
    const seconds = (now - this.at) / 1000;
    if (seconds < 0.5) return this.value;
    const instant = (bytes - this.bytes) / seconds;
    this.at = now;
    this.bytes = bytes;
    if (instant < 0) return this.value; // the counter went backwards: keep the old figure
    this.value = this.value > 0 ? this.value * (1 - this.factor) + instant * this.factor : instant;
    return this.value;
  }
}

/**
 * Fetch every chunk with up to `connections` requests in flight. Resolves when
 * the whole file is on disk and rejects on the first chunk that exhausts its
 * retries, leaving the chunks recorded so far intact for a resume.
 */
export async function runSegments(run: SegmentRun): Promise<void> {
  const chunkBytes = run.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  const connections = Math.max(1, run.connections ?? DEFAULT_CONNECTIONS);
  const maxAttempts = Math.max(1, run.maxAttempts ?? 4);
  const backoff = run.backoffMs ?? [1500, 4000, 9000];
  const progressMs = run.progressMs ?? 250;
  const now = run.now ?? (() => Date.now());
  const sleep = run.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const chunks = planChunks(run.size, chunkBytes);
  const done = new Set<number>();
  for (const index of run.done) {
    if (index >= 0 && index < chunks.length) done.add(index);
  }

  const inFlight = new Map<number, number>();
  const speedometer = new Speedometer();
  let note: string | undefined;
  let failure: Error | null = null;
  let cursor = 0;

  const report = () => {
    let written = 0;
    for (const index of done) written += chunkLength(chunks[index]);
    for (const loaded of inFlight.values()) written += loaded;
    run.onProgress({ written, total: run.size, speed: speedometer.update(now(), written), note });
  };

  const setNote = (next: string | undefined) => {
    if (next === note) return;
    note = next;
    report();
  };

  const timer = setInterval(report, progressMs);
  try {
    const worker = async () => {
      for (;;) {
        if (failure) return;
        if (run.signal?.aborted) {
          failure = new Error('cancelled');
          return;
        }
        const index = cursor++;
        if (index >= chunks.length) return;
        if (done.has(index)) continue;
        const chunk = chunks[index];
        for (let attempt = 1; ; attempt++) {
          if (failure) return;
          if (run.signal?.aborted) {
            failure = new Error('cancelled');
            return;
          }
          inFlight.set(index, 0);
          try {
            const bytes = await run.fetchChunk(chunk, (loaded) => inFlight.set(index, loaded), run.signal);
            if (bytes.length !== chunkLength(chunk)) throw new Error('the server sent a short response');
            await run.sink.writeAt(chunk.start, bytes);
            inFlight.delete(index);
            done.add(index);
            run.onChunkDone?.(index, done);
            setNote(undefined);
            report();
            break;
          } catch (err) {
            inFlight.delete(index);
            if (run.signal?.aborted) {
              failure = new Error('cancelled');
              return;
            }
            if (attempt >= maxAttempts) {
              failure = err instanceof Error ? err : new Error(String(err));
              return;
            }
            setNote(`Connection stalled — retrying (${attempt} of ${maxAttempts - 1})…`);
            await sleep(backoff[Math.min(attempt - 1, backoff.length - 1)]);
          }
        }
      }
    };

    await Promise.all(Array.from({ length: connections }, () => worker()));
    if (failure) throw failure;
    if (done.size < chunks.length) throw new Error('the download finished without every part');
  } finally {
    clearInterval(timer);
    report();
  }
}
