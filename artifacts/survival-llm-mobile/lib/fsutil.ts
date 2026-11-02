/**
 * Small file helpers shared by the download manager and the library.
 * Uses the modern expo-file-system API (File/Directory/Paths).
 */
import { Directory, File, Paths } from 'expo-file-system';
import { sha256 } from 'js-sha256';

/** expo-file-system URIs are file:// URLs; SQLite and llama.cpp want plain paths. */
export function plainPath(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

export const DATA_DIR = new Directory(Paths.document, 'survival-llm');
export const LIBRARY_DIR = new Directory(DATA_DIR.uri, 'library');
export const LIBRARY_TEXT_DIR = new Directory(LIBRARY_DIR.uri, 'text');
export const MODELS_DIR = new Directory(DATA_DIR.uri, 'models');
export const PARTS_DIR = new Directory(DATA_DIR.uri, 'parts');

export function ensureDirs() {
  for (const dir of [DATA_DIR, LIBRARY_DIR, LIBRARY_TEXT_DIR, MODELS_DIR, PARTS_DIR]) {
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  }
}

export function fileAt(dir: Directory, name: string): File {
  return new File(dir.uri, name);
}

export function fileSize(file: File): number {
  try {
    return file.exists ? (file.size ?? 0) : 0;
  } catch {
    return 0;
  }
}

/** Incremental sha256 over a (possibly multi-GB) file, read in 4 MB chunks. */
export async function sha256File(file: File): Promise<string> {
  const handle = file.open();
  try {
    const hasher = sha256.create();
    const total = file.size ?? 0;
    let offset = 0;
    const CHUNK = 4 * 1024 * 1024;
    while (offset < total) {
      handle.offset = offset;
      const bytes = await handle.readBytes(Math.min(CHUNK, total - offset));
      if (!bytes || bytes.length === 0) break;
      hasher.update(bytes);
      offset += bytes.length;
      // Let the JS thread breathe so progress UI keeps painting.
      await new Promise((r) => setTimeout(r, 0));
    }
    return hasher.hex();
  } finally {
    handle.close();
  }
}

export function gb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

export function deleteQuietly(file: File) {
  try {
    if (file.exists) file.delete();
  } catch {
    // best effort
  }
}
