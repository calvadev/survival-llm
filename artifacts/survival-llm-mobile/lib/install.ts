/**
 * Download manager: models (GGUF) and library packs, resumable, with the same
 * discipline as the desktop installer — every download's sha256 is verified
 * before it is used, and a failed check is a loud error, never a warning.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LegacyFS from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import { Unzip, UnzipInflate } from 'fflate';
import { ModelInfo, PackInfo } from './catalog';
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
}

type Listener = (job: Job) => void;

const jobs = new Map<string, Job>();
const listeners = new Set<Listener>();
const active = new Map<string, LegacyFS.DownloadResumable>();

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

const resumeKey = (key: string) => `sl:resume:${key}`;
const partUri = (name: string) => `${PARTS_DIR.uri}/${name}`;

async function saveResume(key: string, data: string | null) {
  try {
    if (data) await AsyncStorage.setItem(resumeKey(key), data);
    else await AsyncStorage.removeItem(resumeKey(key));
  } catch {
    // best effort
  }
}

async function runDownload(
  key: string,
  url: string,
  fileUri: string,
  onProgress: (written: number, expected: number) => void,
): Promise<void> {
  const saved = await AsyncStorage.getItem(resumeKey(key));
  const resumable = LegacyFS.createDownloadResumable(
    url,
    fileUri,
    {},
    (p) => onProgress(p.totalBytesWritten, p.totalBytesExpectedToWrite),
    saved || undefined,
  );
  active.set(key, resumable);
  const result = saved ? await resumable.resumeAsync() : await resumable.downloadAsync();
  active.delete(key);
  if (!result || result.status < 200 || result.status >= 300) {
    throw new Error(`The download failed (the site answered HTTP ${result?.status ?? 'nothing'}). Try again.`);
  }
  await saveResume(key, null);
}

export async function pauseJob(key: string) {
  const r = active.get(key);
  if (!r) return;
  try {
    const state = await r.pauseAsync();
    await saveResume(key, (state as any)?.resumeData ?? null);
  } catch {
    // already finished
  }
  const job = jobs.get(key);
  if (job && job.status === 'downloading') emit({ ...job, status: 'paused' });
}

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
  emit({ key, label: model.name, status: 'downloading', completed: 0, total: model.bytes });
  try {
    await runDownload(key, model.url, partUri(partName), (written, expected) => {
      emit({ key, label: model.name, status: 'downloading', completed: written, total: expected || model.bytes });
    });
    const part = fileAt(PARTS_DIR, partName);
    emit({ key, label: model.name, status: 'verifying', completed: model.bytes, total: model.bytes });
    if (model.sha256) {
      const sum = await sha256File(part);
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
    emit({ key, label: model.name, status: 'done', completed: model.bytes, total: model.bytes });
    return model.file;
  } catch (err: any) {
    emit({ ...jobs.get(key)!, status: 'error', error: err?.message ?? String(err) });
    throw err;
  }
}

/** Download, verify and unpack a library pack. */
export async function downloadPack(pack: PackInfo): Promise<void> {
  ensureDirs();
  const key = `library:${pack.id}`;
  const total = pack.parts.reduce((a, p) => a + p.bytes, 0);
  emit({ key, label: pack.label, status: 'downloading', completed: 0, total });
  try {
    let done = 0;
    const partFiles: File[] = [];
    for (let i = 0; i < pack.parts.length; i++) {
      const part = pack.parts[i];
      const partName = `${pack.id}.${String(i).padStart(3, '0')}.part`;
      // Resume state stays per-part (each part is its own HTTP download), but
      // progress goes to the one pack job — per-part jobs stacked up as
      // identical bars that were never cleared.
      const partKey = `${key}:${i}`;
      const label = pack.parts.length > 1 ? `${pack.label} — part ${i + 1} of ${pack.parts.length}` : pack.label;
      emit({ key, label, status: 'downloading', completed: done, total });
      await runDownload(partKey, part.url, partUri(partName), (written) => {
        emit({ key, label, status: 'downloading', completed: done + written, total });
      });
      const file = fileAt(PARTS_DIR, partName);
      emit({ key, label, status: 'verifying', completed: done + part.bytes, total });
      const sum = await sha256File(file);
      if (sum !== part.sha256) {
        deleteQuietly(file);
        throw new Error(
          'The downloaded library failed its integrity check (the file on disk does not match the published checksum). It was deleted; try the download again.',
        );
      }
      partFiles.push(file);
      done += part.bytes;
      emit({ key, label: pack.label, status: 'downloading', completed: done, total });
    }
    emit({ key, label: pack.label, status: 'unpacking', completed: total, total });
    await unpack(partFiles, (written) => {
      emit({ key, label: pack.label, status: 'unpacking', completed: total, total: total + written });
    });
    for (const f of partFiles) deleteQuietly(f);
    emit({ key, label: pack.label, status: 'done', completed: total, total });
  } catch (err: any) {
    emit({ ...jobs.get(key)!, status: 'error', error: err?.message ?? String(err) });
    throw err;
  }
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
