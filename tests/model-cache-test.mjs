// The model-file cache (src/engine/model-cache.js) with a broken browser Cache Storage: lookups count as not cached
// and stores are skipped, never an error that stops a transcription.   node tests/model-cache-test.mjs
import assert from 'node:assert/strict';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

globalThis.caches = { open: async () => { throw Object.assign(new Error("Failed to execute 'open' on 'CacheStorage': Unexpected internal error."), { name: 'UnknownError' }); } };
const { chunkedCache } = await import('../src/engine/model-cache.js');
const cache = chunkedCache('test');
ok(await cache.match('https://example.test/model.onnx') === undefined, 'a lookup in a broken Cache Storage is a miss, not an error');
await cache.put('https://example.test/model.onnx', new Response(new Uint8Array(8), { headers: { 'content-length': '8' } }));
ok(true, 'storing into a broken Cache Storage is skipped without an error');

// a working store still round-trips (single piece and in parts)
const store = new Map();
globalThis.caches = { open: async () => ({
  match: async (k) => store.get(k)?.clone(),
  put: async (k, r) => { store.set(k, new Response(await r.arrayBuffer(), { status: r.status, headers: r.headers })); },
  delete: async (k) => store.delete(k),
}) };
const parts = chunkedCache('test', { partBytes: 4 });
await parts.put('https://example.test/big.bin', new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])));
const back = new Uint8Array(await (await parts.match('https://example.test/big.bin')).arrayBuffer());
ok(back.length === 10 && back[9] === 10 && store.size === 4, 'a working Cache Storage stores a large file in parts and reads it back whole');

console.log(`\n${pass} checks passed`);
