/**
 * The transfer engine behind the model and library downloads.
 *
 * Large files are fetched over parallel HTTP range requests (lib/segment.ts)
 * with the chunks written straight to their offsets, and the set of chunks
 * already on disk is kept so an interrupted transfer resumes. Servers that
 * will not serve byte ranges — and any failure in the segmented path — fall
 * back to expo-file-system's native downloader, wrapped in the same stall
 * watchdog and bounded retries, so a connection that goes silent is retried
 * rather than hanging the bar forever.
 *
 * Either way the caller still hashes the finished file before it is used: a
 * transfer that goes wrong fails its checksum and is deleted, never kept.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, FileMode } from 'expo-file-system';
import * as LegacyFS from 'expo-file-system/legacy';
import { Chunk, Sink, packDone, runSegments, unpackDone } from './segment';

export interface TransferProgress {
  /** Bytes on disk for this file so far, including anything resumed. */
  written: number;
  /** Expected total in bytes, or 0 when the server never said. */
  total: number;
  /** Smoothed throughput in bytes per second; 0 until there is enough to measure. */
  speed: number;
  /** 1-based number of the attempt now running. */
  attempt: number;
  /** A short line for the UI about a stall, retry or fallback; absent when all is well. */
  note?: string;
}

export interface TransferOptions {
  key: string;
  url: string;
  /** The destination file (the .part path). Overwritten, not appended to. */
  dest: File;
  expectedBytes?: number;
  headers?: Record<string, string>;
  onProgress: (p: TransferProgress) => void;
  signal?: AbortSignal;
}

/** Below this, a single connection is just as fast and much simpler. */
const SEGMENT_MIN_BYTES = 12 * 1024 * 1024;
const CHUNK_BYTES = 4 * 1024 * 1024;
const CONNECTIONS = 4;
/** A transfer that produces no bytes for this long is aborted and retried. */
const STALL_MS = 30_000;
const QUIET_NOTE_MS = 12_000;
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [1500, 3000, 7000, 15000];

// Range requests are meaningless if the body is re-compressed in flight, and
// some CDNs (GitHub's asset host among them) prefer an explicit identity.
const DEFAULT_HEADERS: Record<string, string> = {
  'Accept-Encoding': 'identity',
  'User-Agent': 'Survival-LLM-Android',
};

/** Aborts the transfer for a given key (the UI's pause). */
const active = new Map<string, () => void>();

export function pauseTransfer(key: string): void {
  active.get(key)?.();
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const chunksKey = (key: string) => `sl:chunks:${key}`;
const resumeKey = (key: string) => `sl:resume:${key}`;

interface ServerInfo {
  size: number;
  ranges: boolean;
}

/**
 * Ask the server for a single byte to learn the file's size and whether it
 * will serve byte ranges. A 206 answers both; a 200 means the range was
 * ignored and the file has to be taken in one piece. The body is never read —
 * the probe is aborted as soon as the headers are in hand.
 */
async function probeServer(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<ServerInfo> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const resp = await fetch(url, { headers: { ...headers, Range: 'bytes=0-0' }, signal: controller.signal });
    if (resp.status === 206) {
      const range = resp.headers.get('Content-Range') ?? '';
      const total = Number(/\/(\d+)\s*$/.exec(range)?.[1] ?? 0);
      const accept = (resp.headers.get('Accept-Ranges') ?? '').toLowerCase();
      return { size: total, ranges: total > 0 || accept.includes('bytes') };
    }
    if (resp.status === 200) {
      return { size: Number(resp.headers.get('Content-Length') ?? 0), ranges: false };
    }
    return { size: 0, ranges: false };
  } finally {
    controller.abort();
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * One range request, with progress callbacks and a stall watchdog. XHR is used
 * rather than fetch because it reports incremental progress and can be aborted
 * mid-body, which is what lets a chunk that goes silent be retried instead of
 * hanging the whole download.
 */
function fetchChunk(
  url: string,
  headers: Record<string, string>,
  chunk: Chunk,
  onBytes: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let lastActivity = Date.now();

    const cleanup = () => {
      clearInterval(watchdog);
      signal?.removeEventListener('abort', onAbort);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        xhr.abort();
      } catch {
        // already finished
      }
      reject(error);
    };
    const onAbort = () => fail(new Error('cancelled'));
    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity > STALL_MS) fail(new Error('the connection stopped sending data'));
    }, 2000);

    xhr.open('GET', url);
    xhr.responseType = 'arraybuffer';
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.setRequestHeader('Range', `bytes=${chunk.start}-${chunk.end}`);
    xhr.onprogress = (event) => {
      lastActivity = Date.now();
      onBytes(event.loaded);
    };
    xhr.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (xhr.status !== 206) {
        reject(new Error(`the server answered HTTP ${xhr.status} to a byte-range request`));
        return;
      }
      const body = xhr.response as ArrayBuffer | null;
      if (!body) {
        reject(new Error('the server sent an empty response'));
        return;
      }
      resolve(new Uint8Array(body));
    };
    xhr.onerror = () => fail(new Error('the connection failed'));
    xhr.ontimeout = () => fail(new Error('the connection timed out'));
    signal?.addEventListener('abort', onAbort);
    if (signal?.aborted) {
      fail(new Error('cancelled'));
      return;
    }
    xhr.send();
  });
}

/** Writes chunks at their offsets, one file handle per write. */
class FileSink implements Sink {
  constructor(private readonly file: File) {}

  async writeAt(offset: number, bytes: Uint8Array): Promise<void> {
    const handle = this.file.open(FileMode.ReadWrite);
    try {
      handle.offset = offset;
      await handle.writeBytes(bytes);
    } finally {
      handle.close();
    }
  }
}

interface StoredChunks {
  size: number;
  hex: string;
}

async function loadDone(key: string, size: number): Promise<Set<number>> {
  try {
    const raw = await AsyncStorage.getItem(chunksKey(key));
    if (!raw) return new Set();
    const stored = JSON.parse(raw) as StoredChunks;
    if (!stored || stored.size !== size) return new Set();
    return unpackDone(stored.hex);
  } catch {
    return new Set();
  }
}

async function saveDone(key: string, size: number, count: number, done: Set<number>): Promise<void> {
  try {
    await AsyncStorage.setItem(chunksKey(key), JSON.stringify({ size, hex: packDone(count, done) }));
  } catch {
    // best effort: losing the record only costs a re-download of finished chunks
  }
}

async function forgetDone(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(chunksKey(key));
  } catch {
    // best effort
  }
}

/**
 * Parallel ranged transfer. The file is created at its full length up front so
 * a partial attempt looks like a short read rather than a complete file; the
 * set of chunks actually written is what makes it resumable and recognisable.
 */
async function segmentedTransfer(
  o: TransferOptions,
  headers: Record<string, string>,
  size: number,
): Promise<void> {
  const count = Math.ceil(size / CHUNK_BYTES);
  // A bitset only means anything for the file it was written for: trust it
  // only when the destination is exactly the right length, or a file the user
  // cleared would be skipped over as "already downloaded".
  const usable = o.dest.exists && o.dest.size === size;
  const done = usable ? await loadDone(o.key, size) : new Set<number>();
  if (!usable) {
    if (o.dest.exists) o.dest.delete();
    o.dest.create({ intermediates: true, overwrite: true });
    await forgetDone(o.key);
    const handle = o.dest.open(FileMode.ReadWrite);
    try {
      handle.offset = size - 1;
      await handle.writeBytes(new Uint8Array([0]));
    } finally {
      handle.close();
    }
  }

  await runSegments({
    url: o.url,
    size,
    sink: new FileSink(o.dest),
    done,
    chunkBytes: CHUNK_BYTES,
    connections: CONNECTIONS,
    maxAttempts: 4,
    backoffMs: [1500, 4000, 9000],
    signal: o.signal,
    fetchChunk: (chunk, onBytes, signal) => fetchChunk(o.url, headers, chunk, onBytes, signal),
    onChunkDone: (index, written) => void saveDone(o.key, size, count, written),
    onProgress: (p) =>
      o.onProgress({ written: p.written, total: p.total, speed: p.speed, attempt: 1, note: p.note }),
  });
}

/**
 * expo-file-system's single-connection downloader: slower on a big file but it
 * handles redirects, TLS and resume itself. Every attempt is watched for a
 * stall and every failure is retried, resuming from the bytes already written
 * rather than starting the file over.
 */
async function nativeTransfer(
  o: TransferOptions,
  headers: Record<string, string>,
  expected: number,
): Promise<void> {
  let resumeData = (await AsyncStorage.getItem(resumeKey(o.key))) || undefined;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (o.signal?.aborted) throw new Error('cancelled');
    let written = 0;
    let total = expected;
    let lastSeen = -1;
    let lastChange = Date.now();
    const report = (note?: string) =>
      o.onProgress({ written, total, speed: 0, attempt, note });

    const task = LegacyFS.createDownloadResumable(
      o.url,
      o.dest.uri,
      { headers },
      (p) => {
        written = p.totalBytesWritten ?? written;
        if (p.totalBytesExpectedToWrite > 0) total = p.totalBytesExpectedToWrite;
        if (written !== lastSeen) {
          lastSeen = written;
          lastChange = Date.now();
        }
        report();
      },
      resumeData,
    );

    let interrupt: 'stall' | 'cancel' | null = null;
    const watchdog = setInterval(() => {
      if (written !== lastSeen) {
        lastSeen = written;
        lastChange = Date.now();
        return;
      }
      const quiet = Date.now() - lastChange;
      if (quiet >= STALL_MS && !interrupt) {
        interrupt = 'stall';
        void task.pauseAsync().catch(() => {});
      } else if (quiet >= QUIET_NOTE_MS) {
        report('The connection has gone quiet — still trying…');
      }
    }, 1000);
    const onAbort = () => {
      interrupt = 'cancel';
      void task.pauseAsync().catch(() => {});
    };
    o.signal?.addEventListener('abort', onAbort);
    active.set(o.key, onAbort);

    let result: any = null;
    let error: any = null;
    try {
      result = resumeData ? await task.resumeAsync() : await task.downloadAsync();
    } catch (err) {
      error = err;
    }
    clearInterval(watchdog);
    o.signal?.removeEventListener('abort', onAbort);
    active.delete(o.key);

    // Keep whatever the native side can hand back so the next attempt resumes.
    try {
      const state: any = await task.pauseAsync();
      if (state?.resumeData) resumeData = state.resumeData;
    } catch {
      // finished, or nothing left to resume from
    }

    if (interrupt === 'cancel' || o.signal?.aborted) {
      if (resumeData) await AsyncStorage.setItem(resumeKey(o.key), resumeData).catch(() => {});
      throw new Error('cancelled');
    }
    if (!error && result && result.status >= 200 && result.status < 300) {
      await AsyncStorage.removeItem(resumeKey(o.key)).catch(() => {});
      return;
    }

    const status: number | undefined = result?.status;
    if (status && status >= 400 && status < 500) {
      throw new Error(`The site refused the download (HTTP ${status}). Check the address and try again.`);
    }
    if (error) lastError = error instanceof Error ? error : new Error(String(error));
    else if (status) lastError = new Error(`The site answered HTTP ${status}.`);
    else lastError = new Error('The download stopped before it finished.');

    if (attempt >= MAX_ATTEMPTS) break;
    o.onProgress({
      written,
      total,
      speed: 0,
      attempt,
      note: `Connection lost — retrying (${attempt} of ${MAX_ATTEMPTS - 1})…`,
    });
    await sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]);
  }
  throw lastError ?? new Error('The download failed.');
}

/**
 * Download `dest` from `url`, resuming whatever is already there. Prefers the
 * parallel ranged path for large files and falls back to the native downloader
 * whenever the server or the segmented path will not cooperate, so the worst
 * case is the single-connection speed rather than a broken download.
 */
export async function downloadFile(o: TransferOptions): Promise<void> {
  const headers = { ...DEFAULT_HEADERS, ...o.headers };
  const controller = new AbortController();
  const forward = () => controller.abort();
  o.signal?.addEventListener('abort', forward);
  active.set(o.key, forward);
  const options: TransferOptions = { ...o, signal: controller.signal };

  try {
    let info: ServerInfo = { size: o.expectedBytes ?? 0, ranges: false };
    try {
      const probed = await probeServer(o.url, headers, controller.signal);
      if (probed.size > 0) info.size = probed.size;
      info.ranges = probed.ranges;
    } catch {
      // The probe is an optimization; the downloaders report the real error.
    }

    if (info.ranges && info.size >= SEGMENT_MIN_BYTES) {
      try {
        await segmentedTransfer(options, headers, info.size);
        return;
      } catch (err) {
        if (controller.signal.aborted) throw err;
        await forgetDone(o.key);
        o.onProgress({
          written: 0,
          total: info.size,
          speed: 0,
          attempt: 1,
          note: 'Falling back to a single connection…',
        });
      }
    }

    await nativeTransfer(options, headers, info.size || o.expectedBytes || 0);
  } finally {
    active.delete(o.key);
    o.signal?.removeEventListener('abort', forward);
  }
}
