/**
 * Web shim for fsutil. expo-file-system's modern API has no web
 * implementation — constructing a Directory throws at import time, which
 * broke the whole web preview (SSR 500). Metro resolves this file instead
 * of fsutil.ts for web bundles. On web there is no filesystem: nothing is
 * installed, nothing downloads, and the UI already reflects that
 * (engineAvailable() is false, installedModelPath()/installedLibraryIndex()
 * return null via the stubs below).
 */
import type { Directory, File } from 'expo-file-system';

export function plainPath(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

const noDir = { exists: false, uri: '' } as unknown as Directory;
const noFile = { exists: false, size: 0, uri: '' } as unknown as File;

export const DATA_DIR = noDir;
export const LIBRARY_DIR = noDir;
export const LIBRARY_TEXT_DIR = noDir;
export const MODELS_DIR = noDir;
export const PARTS_DIR = noDir;

export function ensureDirs() {}

export function fileAt(_dir: Directory, _name: string): File {
  return noFile;
}

export function fileSize(_file: File): number {
  return 0;
}

export async function sha256File(_file: File): Promise<string> {
  throw new Error('No filesystem in the web preview');
}

export function gb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

export function deleteQuietly(_file: File) {}
