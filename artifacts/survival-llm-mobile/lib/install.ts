/**
 * Download manager: models (GGUF) and library packs, resumable, with the same
 * discipline as the desktop installer — every download's sha256 is verified
 * before it is used, and a failed check is a loud error, never a warning.
 *
 * The transfers themselves live in ./download: parallel ranged requests where
 * the server allows them, expo-file-system's native downloader otherwise, both
 * watched for stalls and retried. This file is the bookkeeping around them —
 * what is downloading, how fast, how much is left, and what the UI should say.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';
import { Unzip, UnzipInflate } from 'fflate';
import { ModelInfo, PackInfo } from './catalog';
import { downloadFile, pauseTransfer, TransferProgress } from './download';
import {
  ensureDirs,
  fileAt,
  fileSize,
  gb,
  LIBRARY_DIR,
  LIBRARY_TEXT_DIR,
  MODELS_DIR,
  PARTS_DIR,
  sha256File,
  deleteQuietly,
} from './fsutil';

export type JobStatus = 'idle' | 'downloading' | 'paused' | 'verifying' | 'unpacking' | 'done' | 'error';

export interface Job {
  key: string;
  label: string;
  status: JobStatus;
  completed: number;
  total: number;
  error?: string;
  /** Smoothed throughput in bytes per second, while downloading. */
  speed?: number;
  /** Seconds remaining, when the speed and the total are both known. */
  eta?: number;
  /** A short line about a stall, retry or fallback; absent when all is well. */
  note?: string;
  /** 1-based number of the attempt now running, when it is a retry. */
  attempt?: number;
}

type Listener = (job: Job) => void;

const jobs = new Map<string, Job>();
const listeners = new Set<Listener>();

function emit(job: Job) {
  jobs.set(job.key, job);
  for (const l of listeners) l(job);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentJobs(): Job[] {
  return [...jobs.values()];
}

const partUri = (name: string) => `${PARTS_DIR.uri}/${name}`;

/** Seconds remaining at the current rate, or 0 when it cannot be estimated. */
function etaSeconds(written: number, total: number, speed: number): number {
  if (!speed || !total || total <= written) return 0;
  return (total - written) / speed;
}

/**
 * A download that makes no progress used to look like a frozen bar with no
 * explanation. Say so, so "it is stuck" reads as "it is retrying".
 *
 * The rate is worked out here rather than in the transfer so the figure
 * survives a retry (which restarts the per-attempt counter) and covers the
 * gap between bytes.
 */
const QUIET_MS = 12_000;
const seen = new Map<string, { completed: number; at: number }>();
setInterval(() => {
  const now = Date.now();
  for (const job of jobs.values()) {
    if (job.status !== 'downloading') {
      seen.delete(job.key);
      continue;
    }
    const previous = seen.get(job.key);
    if (!previous || previous.completed !== job.completed) {
      seen.set(job.key, { completed: job.completed, at: now });
      continue;
    }
    if (now - previous.at > QUIET_MS && !job.note) {
      emit({ ...job, note: 'No new data for a while — the connection may be stalling.' });
    }
  }
}, 3000);

/** The GGUF magic bytes — the integrity floor for user-supplied model URLs. */
async function looksLikeGguf(file: File): Promise<boolean> {
  const handle = file.open();
  try {
    handle.offset = 0;
    const head = await handle.readBytes(4);
    return head.length === 4 && head[0] === 0x47 && head[1] === 0x47 && head[2] === 0x55 && head[3] === 0x46; // "GGUF"
  } finally {
    handle.close();
  }
}

/** Download one of the catalog models and verify it. Result: its file name inside MODELS_DIR. */
export async function downloadModel(model: ModelInfo): Promise<string> {
  ensureDirs();
  const key = `model:${model.key}`;
  const partName = model.file + '.part';
  const part = fileAt(PARTS_DIR, partName);
  const label = model.name;

  const report = (p: TransferProgress) =>
    emit({
      key,
      label,
      status: 'downloading',
      completed: p.written,
      total: p.total || model.bytes,
      speed: p.speed,
      eta: etaSeconds(p.written, p.total || model.bytes, p.speed),
      note: p.note,
      attempt: p.attempt,
    });

  emit({ key, label, status: 'downloading', completed: 0, total: model.bytes, speed: 0 });
  try {
    await downloadFile({ key, url: model.url, dest: part, expectedBytes: model.bytes, onProgress: report });
    emit({ key, label, status: 'verifying', completed: 0, total: model.bytes, speed: 0 });
    if (model.sha256) {
      const sum = await sha256File(part, (hashed) =>
        emit({ key, label, status: 'verifying', completed: hashed, total: model.bytes, speed: 0 }),
      );
      if (sum !== model.sha256) {
        deleteQuietly(part);
        throw new Error(
          'The downloaded model failed its integrity check (it does not match the published checksum). ' +
            'It was deleted; try the download again.',
        );
      }
    } else {
      // A user-supplied URL has no published checksum: require the size and the GGUF magic.
      const size = fileSize(part);
      if (size < 100 * 1024 * 1024 || !(await looksLikeGguf(part))) {
        deleteQuietly(part);
        throw new Error('That file is not a usable GGUF model. Check the address and try again.');
      }
    }
    const dest = fileAt(MODELS_DIR, model.file);
    deleteQuietly(dest);
    part.move(dest);
    emit({ key, label, status: 'done', completed: model.bytes, total: model.bytes });
    return model.file;
  } catch (err: any) {
    emit({ ...jobs.get(key)!, status: 'error', error: err?.message ?? String(err), speed: 0, eta: 0 });
    throw err;
  }
}

/** Download, verify and unpack a library pack. */
export async function downloadPack(pack: PackInfo): Promise<void> {
  ensureDirs();
  const key = `library:${pack.id}`;
  const total = pack.parts.reduce((a, p) => a + p.bytes, 0);
  emit({ key, label: pack.label, status: 'downloading', completed: 0, total, speed: 0 });
  try {
    let done = 0;
    const partFiles: File[] = [];
    for (let i = 0; i < pack.parts.length; i++) {
      const part = pack.parts[i];
      const partName = `${pack.id}.${String(i).padStart(3, '0')}.part`;
      const file = fileAt(PARTS_DIR, partName);
      // Resume state stays per-part (each part is its own HTTP download), but
      // progress goes to the one pack job — per-part jobs stacked up as
      // identical bars that were never cleared.
      const partKey = `${key}:${i}`;
      const label = pack.parts.length > 1 ? `${pack.label} — part ${i + 1} of ${pack.parts.length}` : pack.label;
      emit({ key, label, status: 'downloading', completed: done, total, speed: 0 });
      await downloadFile({
        key: partKey,
        url: part.url,
        dest: file,
        expectedBytes: part.bytes,
        onProgress: (p) => {
          const completed = done + Math.min(p.written, part.bytes);
          emit({
            key,
            label,
            status: 'downloading',
            completed,
            total,
            speed: p.speed,
            eta: etaSeconds(completed, total, p.speed),
            note: p.note,
            attempt: p.attempt,
          });
        },
      });
      emit({ key, label, status: 'verifying', completed: done, total, speed: 0 });
      const sum = await sha256File(file, (hashed) =>
        emit({ key, label, status: 'verifying', completed: done + Math.min(hashed, part.bytes), total, speed: 0 }),
      );
      if (sum !== part.sha256) {
        deleteQuietly(file);
        throw new Error(
          'The downloaded library failed its integrity check (the file on disk does not match the published checksum). It was deleted; try the download again.',
        );
      }
      partFiles.push(file);
      done += part.bytes;
      emit({ key, label: pack.label, status: 'downloading', completed: done, total, speed: 0 });
    }
    emit({ key, label: pack.label, status: 'unpacking', completed: total, total });
    await unpack(partFiles, (written) => {
      emit({ key, label: pack.label, status: 'unpacking', completed: total, total: total + written });
    });
    for (const f of partFiles) deleteQuietly(f);
    emit({ key, label: pack.label, status: 'done', completed: total, total });
  } catch (err: any) {
    emit({ ...jobs.get(key)!, status: 'error', error: err?.message ?? String(err), speed: 0, eta: 0 });
    throw err;
  }
}

/** Pause the transfer behind a job, keeping what has been written so far. */
export async function pauseJob(key: string) {
  pauseTransfer(key);
  const job = jobs.get(key);
  if (job && job.status === 'downloading') emit({ ...job, status: 'paused', note: 'Paused — your progress is saved.', speed: 0 });
}

/** Map a zip entry name to its destination inside the library folder. */
function destFor(name: string): File | null {
  const clean = name.replace(/^\.\//, '');
  if (!clean || clean.endsWith('/')) return null;
  const segments = clean.split('/');
  if (segments[segments.length - 1] === 'index.sqlite') return new File(LIBRARY_DIR.uri, 'index.sqlite');
  const t = segments.indexOf('text');
  if (t >= 0 && t < segments.length - 1) return new File(LIBRARY_TEXT_DIR.uri, ...segments.slice(t + 1));
  return null;
}

/**
 * Unpack the pack's zip parts with fflate's streaming unzip. The pack zips are
 * DEFLATE-compressed (packaging/make_packs.py), so UnzipInflate must be
 * registered; writes are awaited in order per file, with backpressure so the
 * inflater can't outrun the disk.
 */
async function unpack(parts: File[], onWrite: (bytes: number) => void): Promise<void> {
  // Fresh target: a partial earlier attempt must not linger.
  try {
    if (LIBRARY_DIR.exists) LIBRARY_DIR.delete();
  } catch {
    // best effort
  }
  LIBRARY_DIR.create({ intermediates: true, idempotent: true });
  LIBRARY_TEXT_DIR.create({ intermediates: true, idempotent: true });

  const CHUNK = 4 * 1024 * 1024;
  const MAX_BUFFER = 32 * 1024 * 1024; // inflated bytes allowed to be ahead of the disk
  let written = 0;
  let pending = 0;
  let buffered = 0;
  let failed: Error | null = null;
  const fileWaiters: (() => void)[] = [];
  const drainWaiters: (() => void)[] = [];
  const pokeFiles = () => fileWaiters.splice(0).forEach((w) => w());
  const pokeDrain = () => drainWaiters.splice(0).forEach((w) => w());

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (entry) => {
    const dest = destFor(entry.name);
    if (!dest) return; // not started: fflate skips its data
    let handle: ReturnType<File['open']>;
    try {
      dest.create({ intermediates: true, overwrite: true });
      handle = dest.open();
    } catch (err: any) {
      failed = err instanceof Error ? err : new Error(String(err));
      return;
    }
    pending += 1;
    let finished = false;
    const finish = () => {
      if (!finished) {
        finished = true;
        pending -= 1;
        pokeFiles();
      }
    };
    // Writes to one file must land in order, and writeBytes is asynchronous:
    // chain them. Errors and the final chunk close the handle exactly once.
    let chain: Promise<void> = Promise.resolve();
    entry.ondata = (err, chunk, final) => {
      const data = chunk;
      buffered += data.length;
      chain = chain.then(async () => {
        try {
          if (err) throw err instanceof Error ? err : new Error(String(err));
          if (!failed) {
            if (data.length) {
              await handle.writeBytes(data);
              written += data.length;
              if (written % (32 * 1024 * 1024) < data.length) onWrite(written);
            }
            if (final) await handle.close();
          }
        } catch (e: any) {
          failed = failed ?? (e instanceof Error ? e : new Error(String(e)));
          try {
            await handle.close();
          } catch {
            // already closed
          }
        } finally {
          buffered -= data.length;
          if (buffered <= MAX_BUFFER) pokeDrain();
          if (final || failed) finish();
        }
      });
    };
    entry.start();
  };

  for (const part of parts) {
    const handle = part.open();
    const total = part.size ?? 0;
    let offset = 0;
    try {
      while (offset < total) {
        if (failed) throw failed;
        while (buffered > MAX_BUFFER) {
          await new Promise<void>((r) => drainWaiters.push(r));
          if (failed) throw failed;
        }
        handle.offset = offset;
        const bytes = await handle.readBytes(Math.min(CHUNK, total - offset));
        if (!bytes || bytes.length === 0) break;
        unzip.push(bytes, false);
        offset += bytes.length;
        await new Promise((r) => setTimeout(r, 0)); // let progress paint
      }
    } finally {
      handle.close();
    }
  }
  if (failed) throw failed;
  unzip.push(new Uint8Array(0), true);
  while (pending > 0) {
    await new Promise<void>((r) => fileWaiters.push(r));
    if (failed) throw failed;
  }
  if (failed) throw failed;
  const index = new File(LIBRARY_DIR.uri, 'index.sqlite');
  if (!index.exists || fileSize(index) === 0) {
    throw new Error('The library unpacked without its search index. The download may be damaged; try again.');
  }
}

/** Where a downloaded model file lives, if it does. */
export function installedModelPath(fileName: string): string | null {
  const f = fileAt(MODELS_DIR, fileName);
  return f.exists && fileSize(f) > 0 ? f.uri : null;
}

export function installedLibraryIndex(): string | null {
  const f = new File(LIBRARY_DIR.uri, 'index.sqlite');
  return f.exists && fileSize(f) > 0 ? f.uri : null;
}

export async function removeModel(fileName: string) {
  deleteQuietly(fileAt(MODELS_DIR, fileName));
}

export async function removeLibrary() {
  try {
    if (LIBRARY_DIR.exists) LIBRARY_DIR.delete();
  } catch {
    // best effort
  }
}

export { gb };
