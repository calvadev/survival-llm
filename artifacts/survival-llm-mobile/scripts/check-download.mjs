/**
 * Checks the download engine's pure core (lib/segment.ts) against a real
 * ranged HTTP server: that the assembled file matches byte for byte, that a
 * resumed transfer refetches only the missing chunks, that a failed chunk is
 * retried and surfaced to the UI, that a hopeless chunk fails loudly instead
 * of hanging, and that an abort stops the run.
 *
 * Run with `pnpm --filter @workspace/survival-llm-mobile run check:download`.
 * Node runs the TypeScript directly; there is no build step.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { runSegments, planChunks, packDone, unpackDone, Speedometer } from '../lib/segment.ts';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const SIZE = 24 * 1024 * 1024;
const CHUNK = 4 * 1024 * 1024;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'survival-download-check-'));
const source = crypto.randomBytes(SIZE);
const sourceHash = sha(source);

// How many times a given chunk index should be answered with an error before
// it is served normally, used to exercise the retry path.
const rangeFailures = new Map();
const server = http.createServer((req, res) => {
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, { 'Content-Length': SIZE });
    res.end(source);
    return;
  }
  const m = /bytes=(\d+)-(\d+)/.exec(range);
  const start = Number(m[1]);
  const end = Math.min(Number(m[2]), SIZE - 1);
  const index = Math.floor(start / CHUNK);
  const fail = rangeFailures.get(index) ?? 0;
  if (fail > 0) {
    rangeFailures.set(index, fail - 1);
    res.writeHead(503, { 'Content-Length': 0 });
    res.end();
    return;
  }
  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${SIZE}`,
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes',
  });
  res.end(source.subarray(start, end + 1));
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/file.bin`;

// The same contract the app's XHR fetcher provides.
const fetcher = (log, delayMs = 0) => async (chunk, onBytes, signal) => {
  const resp = await fetch(url, { headers: { Range: `bytes=${chunk.start}-${chunk.end}` }, signal });
  if (resp.status !== 206) throw new Error(`HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  log.push(chunk.index);
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  onBytes(buf.length);
  return new Uint8Array(buf);
};

const sink = (file) => ({
  async writeAt(offset, bytes) {
    const fd = fs.openSync(file, 'r+');
    try {
      fs.writeSync(fd, bytes, 0, bytes.length, offset);
    } finally {
      fs.closeSync(fd);
    }
  },
});

let seq = 0;
const newDest = () => {
  const file = path.join(work, `dest-${seq++}.bin`);
  const fd = fs.openSync(file, 'w');
  fs.ftruncateSync(fd, SIZE);
  fs.closeSync(fd);
  return file;
};

try {
  // 1. Parallel ranged transfer: correct bytes, each chunk once, live progress.
  {
    const dest = newDest();
    const log = [];
    const progress = [];
    await runSegments({
      url, size: SIZE, chunkBytes: CHUNK, connections: 4,
      sink: sink(dest), done: new Set(),
      fetchChunk: fetcher(log, 400),
      onProgress: (p) => progress.push(p),
    });
    check('assembled file matches the source byte for byte', sha(fs.readFileSync(dest)) === sourceHash);
    check('every chunk fetched exactly once', log.length === 6 && new Set(log).size === 6, `fetched ${log.length}`);
    const last = progress[progress.length - 1];
    check('final progress reports the whole file', last.written === SIZE && last.total === SIZE, `${last.written}/${last.total}`);
    check('progress never goes backwards', progress.every((p, i) => i === 0 || p.written >= progress[i - 1].written));
    check('a throughput figure is produced', last.speed > 0, `${(last.speed / 1e6).toFixed(1)} MB/s`);
  }

  // 2. Resume: only the missing chunks are fetched.
  {
    const dest = newDest();
    const chunks = planChunks(SIZE, CHUNK);
    const write = sink(dest);
    for (const i of [0, 1, 2]) {
      const c = chunks[i];
      await write.writeAt(c.start, new Uint8Array(source.subarray(c.start, c.end + 1)));
    }
    const log = [];
    const reported = [];
    await runSegments({
      url, size: SIZE, chunkBytes: CHUNK, connections: 4,
      sink: write, done: new Set([0, 1, 2]),
      fetchChunk: fetcher(log),
      onChunkDone: (index) => reported.push(index),
      onProgress: () => {},
    });
    check('resume refetches only the missing chunks', log.sort().join(',') === '3,4,5', `fetched ${log.join(',')}`);
    check('resumed file still matches the source', sha(fs.readFileSync(dest)) === sourceHash);
    check('resume reports the finished chunks', reported.sort().join(',') === '3,4,5');
  }

  // 3. Retry: a transiently failing chunk is retried and the stall is shown.
  {
    const dest = newDest();
    rangeFailures.set(2, 2);
    const notes = [];
    await runSegments({
      url, size: SIZE, chunkBytes: CHUNK, connections: 4,
      sink: sink(dest), done: new Set(),
      fetchChunk: fetcher([]),
      maxAttempts: 4, backoffMs: [10, 10, 10],
      onProgress: (p) => { if (p.note) notes.push(p.note); },
    });
    rangeFailures.delete(2);
    check('a transient chunk failure is retried to completion', sha(fs.readFileSync(dest)) === sourceHash);
    check('the retry is surfaced to the UI', notes.some((n) => /stalled|retrying/i.test(n)), notes[0] ?? 'no note');
  }

  // 4. A chunk that never succeeds fails the run instead of hanging forever.
  {
    const dest = newDest();
    rangeFailures.set(4, 99);
    let threw = null;
    await runSegments({
      url, size: SIZE, chunkBytes: CHUNK, connections: 4,
      sink: sink(dest), done: new Set(),
      fetchChunk: fetcher([]),
      maxAttempts: 3, backoffMs: [10, 10, 10],
      onProgress: () => {},
    }).catch((e) => { threw = e; });
    rangeFailures.delete(4);
    check('an unrecoverable chunk ends the run with an error', !!threw, threw?.message);
  }

  // 5. Abort stops promptly.
  {
    const dest = newDest();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);
    let threw = null;
    await runSegments({
      url, size: SIZE, chunkBytes: CHUNK, connections: 4,
      sink: sink(dest), done: new Set(),
      fetchChunk: fetcher([]),
      signal: controller.signal,
      onProgress: () => {},
    }).catch((e) => { threw = e; });
    check('an abort ends the run', !!threw);
  }

  // 6. The resume bitset survives a round trip.
  {
    const back = unpackDone(packDone(256, new Set([0, 3, 7, 8, 200])));
    check('the chunk bitset round-trips', [...back].sort((a, b) => a - b).join(',') === '0,3,7,8,200');
    check('chunks outside the file are dropped', !back.has(999));
    const speedo = new Speedometer();
    speedo.update(0, 0);
    speedo.update(1000, 5_000_000);
    check('the speedometer reports throughput', speedo.update(2000, 10_000_000) > 3_000_000);
  }
} finally {
  server.close();
  fs.rmSync(work, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
