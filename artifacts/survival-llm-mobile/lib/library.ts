/**
 * Read-only search over the offline library — a TypeScript port of
 * library/search.py from the desktop app. Same schema (index.sqlite with FTS5),
 * same BM25 ranking with official-source boost, and passage text read from the
 * plain-text shards through the files table, exactly like the desktop reader.
 */
import * as SQLite from 'expo-sqlite';
import { File } from 'expo-file-system';
import { LIBRARY_DIR, LIBRARY_TEXT_DIR } from './fsutil';

export const TOPICS = ['medical', 'emergency', 'howto', 'repair', 'encyclopedia'] as const;

// Ranking boost for sources with editorial review (mirrors search.py).
const OFFICIAL = new Set([
  'ready-gov', 'cdc-travel', 'medlineplus', 'nhs-medicines', 'military-medicine', 'wikem',
  'medical-library', 'water', 'post-disaster', 'food-prep', 'survival-manuals', 'first-aid-guides',
  'usda-canning', 'risk',
]);
const AUTHORITY: Record<string, number> = { wikipedia: 1.15, wikimed: 1.15 };
for (const k of OFFICIAL) AUTHORITY[k] = 1.3;
// Sources published by a government health/emergency agency, the IFRC or WHO.
const OFFICIAL_LABEL = new Set([
  'ready-gov', 'cdc-travel', 'medlineplus', 'military-medicine', 'survival-manuals',
  'first-aid-guides', 'usda-canning',
]);

const STOPWORDS = new Set(
  ('a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves').split(' '),
);

export function queryWords(query: string): string[] {
  return (query.toLowerCase().match(/[\w']+/g) || [])
    .filter((w) => !STOPWORDS.has(w) && w.length > 1)
    .slice(0, 12);
}

export interface SearchHit {
  id: number;
  title: string;
  source: string;
  official: boolean;
  snippet: string;
}

export interface ArticleRead {
  title: string;
  source: string;
  url: string | null;
  official: boolean;
  text: string;
  next_id: number | null;
}

export interface DocumentView {
  doc_id: number;
  title: string;
  source: string;
  url: string | null;
  official: boolean;
  license: string;
  focus: number;
  parts: { id: number; text: string }[];
}

interface InfoRow {
  pid: number;
  did: number;
  title: string;
  label: string;
  topic: string;
  file_id: number;
  p_offset: number;
  p_length: number;
  key: string;
  d_offset: number;
  d_length: number;
}

function snippetOf(text: string, words: string[], width = 360): string {
  const flat = text
    .split('\n')
    .map((l) => l.replace(/^#+/, '').trim())
    .filter(Boolean)
    .join(' ');
  const low = flat.toLowerCase();
  const hits = words.map((w) => low.indexOf(w)).filter((i) => i >= 0);
  const start = hits.length ? Math.max(0, Math.min(...hits) - 80) : 0;
  const out = flat.slice(start, start + width);
  return (start ? '...' : '') + out + (start + width < flat.length ? '...' : '');
}

function utf8(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return decodeURIComponent(escape(bin));
}

export class Library {
  private db: SQLite.SQLiteDatabase;
  private textDir: string; // URI of the library's text/ folder
  private filePaths = new Map<number, string>();

  private constructor(db: SQLite.SQLiteDatabase, textDir: string) {
    this.db = db;
    this.textDir = textDir;
  }

  static async open(): Promise<Library | null> {
    try {
      const db = await SQLite.openDatabaseAsync('index.sqlite', undefined, LIBRARY_DIR.uri);
      await db.getFirstAsync('SELECT 1 FROM sources LIMIT 1');
      return new Library(db, LIBRARY_TEXT_DIR.uri);
    } catch {
      return null; // no library installed yet
    }
  }

  async stats(): Promise<{ articles: number; sources: number }> {
    const row = await this.db.getFirstAsync<{ c: number; d: number }>(
      'SELECT COUNT(*) AS c, COALESCE(SUM(docs), 0) AS d FROM sources WHERE done=1',
    );
    return { articles: row?.d ?? 0, sources: row?.c ?? 0 };
  }

  async labels(): Promise<string[]> {
    const rows = await this.db.getAllAsync<{ label: string }>(
      'SELECT label FROM sources WHERE done=1 ORDER BY docs DESC',
    );
    return rows.map((r) => r.label);
  }

  /** The shard path for a files-table id (search.py: SELECT path FROM files WHERE id=?). */
  private async filePath(fileId: number): Promise<string> {
    let path = this.filePaths.get(fileId);
    if (path === undefined) {
      const row = await this.db.getFirstAsync<{ path: string }>('SELECT path FROM files WHERE id=?', [fileId]);
      path = row?.path ?? '';
      this.filePaths.set(fileId, path);
    }
    return path;
  }

  private async readRaw(relPath: string, offset: number, length: number): Promise<Uint8Array> {
    const file = new File(this.textDir, relPath);
    const handle = file.open();
    try {
      handle.offset = offset;
      return await handle.readBytes(length);
    } finally {
      handle.close();
    }
  }

  private async readText(fileId: number, offset: number, length: number): Promise<string> {
    const rel = await this.filePath(fileId);
    return utf8(await this.readRaw(rel, offset, length));
  }

  async search(query: string, topic?: string, limit = 8): Promise<SearchHit[]> {
    const words = queryWords(query);
    if (!words.length) return [];
    const terms = words.map((w) => '"' + w.replace(/"/g, '') + '"');
    let hits: { rowid: number; rank: number }[] = [];
    for (const joiner of [' ', ' OR ']) {
      hits = await this.db.getAllAsync<{ rowid: number; rank: number }>(
        "SELECT rowid, rank FROM fts WHERE fts MATCH ? AND rank MATCH 'bm25(4.0, 1.0)' ORDER BY rank LIMIT 300",
        [terms.join(joiner)],
      );
      if (hits.length >= 3 || words.length === 1) break;
    }
    if (!hits.length) return [];
    const rank = new Map(hits.map((h) => [h.rowid, h.rank]));
    const marks = hits.map(() => '?').join(',');
    const rows = await this.db.getAllAsync<InfoRow>(
      `SELECT p.id AS pid, d.id AS did, d.title AS title, s.label AS label, s.topic AS topic,
              d.file_id AS file_id, p.offset AS p_offset, p.length AS p_length, s.key AS key,
              d.offset AS d_offset, d.length AS d_length
       FROM passages p JOIN docs d ON d.id = p.doc_id JOIN sources s ON s.id = d.source_id
       WHERE p.id IN (${marks})`,
      hits.map((h) => h.rowid),
    );
    const info = new Map(rows.map((r) => [r.pid, r]));
    // BM25 ranks are negative (lower is better), so a weight above 1 moves a source up.
    const order = [...info.keys()].sort(
      (a, b) => rank.get(a)! * (AUTHORITY[info.get(a)!.key] ?? 1) - rank.get(b)! * (AUTHORITY[info.get(b)!.key] ?? 1),
    );
    const results: SearchHit[] = [];
    const seenDocs = new Set<number>();
    const shown = new Set<string>();
    for (const pid of order) {
      const r = info.get(pid)!;
      if (seenDocs.has(r.did) || (topic && topic !== 'any' && r.topic !== topic)) continue;
      seenDocs.add(r.did);
      const rawBody = await this.readText(r.file_id, r.d_offset, r.d_length);
      const body = rawBody.split('\n\n').slice(1).join('\n\n') || rawBody; // article without its title header
      if (shown.has(body)) continue; // the same article under another title
      shown.add(body);
      const text = await this.readText(r.file_id, r.p_offset, r.p_length);
      results.push({ id: pid, title: r.title, source: r.label, official: OFFICIAL_LABEL.has(r.key), snippet: snippetOf(text, words) });
      if (results.length >= limit) break;
    }
    return results;
  }

  async read(passageId: number, maxChars = 5000): Promise<ArticleRead | null> {
    const row = await this.db.getFirstAsync<{
      doc_id: number;
      title: string;
      label: string;
      url: string | null;
      file_id: number;
      key: string;
    }>(
      `SELECT p.doc_id AS doc_id, d.title AS title, s.label AS label, d.url AS url, d.file_id AS file_id, s.key AS key
       FROM passages p JOIN docs d ON d.id = p.doc_id JOIN sources s ON s.id = d.source_id WHERE p.id=?`,
      [passageId],
    );
    if (!row) return null;
    const parts: string[] = [];
    let size = 0;
    let nextId: number | null = null;
    const rows = await this.db.getAllAsync<{ id: number; offset: number; length: number }>(
      'SELECT id, offset, length FROM passages WHERE doc_id=? AND id>=? ORDER BY id',
      [row.doc_id, passageId],
    );
    for (const p of rows) {
      if (parts.length && size + p.length > maxChars) {
        nextId = p.id;
        break;
      }
      parts.push(await this.readText(row.file_id, p.offset, p.length));
      size += p.length;
    }
    return {
      title: row.title,
      source: row.label,
      url: row.url,
      official: OFFICIAL_LABEL.has(row.key),
      text: parts.join('\n\n'),
      next_id: nextId,
    };
  }

  async document(passageId: number): Promise<DocumentView | null> {
    const row = await this.db.getFirstAsync<{
      did: number;
      title: string;
      label: string;
      url: string | null;
      file_id: number;
      d_offset: number;
      d_length: number;
      key: string;
    }>(
      `SELECT d.id AS did, d.title AS title, s.label AS label, d.url AS url, d.file_id AS file_id,
              d.offset AS d_offset, d.length AS d_length, s.key AS key
       FROM passages p JOIN docs d ON d.id = p.doc_id JOIN sources s ON s.id = d.source_id WHERE p.id=?`,
      [passageId],
    );
    if (!row) return null;
    const rel = await this.filePath(row.file_id);
    const raw = await this.readRaw(rel, row.d_offset, row.d_length);
    const parts: { id: number; text: string }[] = [];
    for (const p of await this.db.getAllAsync<{ id: number; offset: number; length: number }>(
      'SELECT id, offset, length FROM passages WHERE doc_id=? ORDER BY id',
      [row.did],
    )) {
      parts.push({ id: p.id, text: utf8(raw.slice(p.offset - row.d_offset, p.offset - row.d_offset + p.length)) });
    }
    return {
      doc_id: row.did,
      title: row.title,
      source: row.label,
      url: row.url,
      official: OFFICIAL_LABEL.has(row.key),
      license: await this.license(row.key),
      focus: passageId,
      parts,
    };
  }

  private async license(key: string): Promise<string> {
    try {
      const row = await this.db.getFirstAsync<{ license: string }>('SELECT license FROM sources WHERE key=?', [key]);
      return row?.license ?? '';
    } catch {
      return ''; // no license column in older libraries
    }
  }
}
