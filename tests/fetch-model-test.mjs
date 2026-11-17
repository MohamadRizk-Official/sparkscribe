// Model downloads with a checksum (src/engine/fetch-model.js cachedModel, prefetchModel), without browser cache storage:
// progress reports, the SHA-256 check, and failed downloads. fetch is replaced by a stand-in.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

const bytes = new Uint8Array(1000).map((_, i) => i % 251);
const sha = createHash('sha256').update(bytes).digest('hex');
let requests = [];
let mode = 'ok';
globalThis.fetch = async (url) => {
  requests.push(url);
  if (mode === 'missing') return { ok: false, status: 404, body: null, headers: new Headers() };
  const parts = [bytes.slice(0, 400), bytes.slice(400, 700), bytes.slice(700)];
  const body = mode === 'tampered' ? [bytes.slice(0, 400), new Uint8Array(600)] : parts;
  let i = 0;
  return { ok: true, status: 200, headers: new Headers(mode === 'nolength' ? {} : { 'content-length': '1000' }), body: { getReader: () => ({ read: async () => (i < body.length ? { done: false, value: body[i++] } : { done: true }) }) } };
};
const { cachedModel, prefetchModel } = await import(new URL('../src/engine/fetch-model.js', import.meta.url).href);

// ---- a good download ----
const events = [];
const buf = await cachedModel('https://example.test/models/step.onnx', sha, { onProgress: (e) => events.push(e) });
ok(buf instanceof ArrayBuffer && buf.byteLength === 1000, 'the file comes back as an ArrayBuffer of the right size');
ok(Buffer.from(buf).equals(Buffer.from(bytes)), 'the parts are joined in order');
ok(requests.length === 1 && requests[0] === 'https://example.test/models/step.onnx', 'one request is made for the URL');
const progress = events.filter((e) => e.status === 'progress');
ok(progress.length === 3 && progress.map((e) => e.loaded).join() === '400,700,1000', 'progress is reported after every chunk with the bytes so far');
ok(progress.every((e) => e.file === 'step.onnx' && e.total === 1000), 'progress names the file and its total size');
ok(progress[2].progress === 100 && progress[0].progress === 40, 'progress is a percentage of the total');
ok(events.at(-1).status === 'done' && events.at(-1).file === 'step.onnx', 'a done event ends the download');

// ---- no content-length ----
mode = 'nolength';
const e2 = [];
await cachedModel('https://example.test/a.bin', sha, { onProgress: (e) => e2.push(e) });
ok(e2.filter((e) => e.status === 'progress').every((e) => e.total === 0 && e.progress === 0), 'with an unknown size progress stays at 0%');

// ---- failures ----
mode = 'missing';
let err = await cachedModel('https://example.test/gone.onnx', sha).catch((e) => e);
ok(err instanceof Error && err.message === 'model download failed (404)', 'an HTTP error fails with the status');
mode = 'tampered';
err = await cachedModel('https://example.test/bad.onnx', sha).catch((e) => e);
ok(err instanceof Error && /bad\.onnx did not match its checksum/.test(err.message), 'a file with the wrong checksum is refused, naming the file');
mode = 'ok';
err = await cachedModel('https://example.test/step.onnx', 'f'.repeat(64)).catch((e) => e);
ok(err instanceof Error && /did not match its checksum/.test(err.message), 'a good file against the wrong expected checksum is also refused');

// ---- prefetch ----
requests = [];
await prefetchModel('https://example.test/models/step.onnx', sha);
ok(requests.length === 1, 'prefetch downloads a file that is not cached (no cache storage in Node)');
err = await prefetchModel('https://example.test/x.onnx', 'a'.repeat(64)).catch((e) => e);
ok(err instanceof Error, 'prefetch also checks the checksum');

console.log(`${pass} checks passed`);
