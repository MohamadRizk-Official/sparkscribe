// D6: model-file cache (src/engine/model-cache.js) in a real Chromium Cache Storage. No downloads: synthetic files.
import { runTests, assert, eq } from './lib.js';

const MiB = 1048576;
const bytes = (n, seed = 7) => { const b = new Uint8Array(n); for (let i = 0; i < n; i += 997) b[i] = (i * seed) & 255; b[n - 1] = 42; return b; };
const same = async (resp, src) => { const got = new Uint8Array(await resp.arrayBuffer()); if (got.length !== src.length) return false; for (let i = 0; i < src.length; i += 997) if (got[i] !== src[i]) return false; return got[src.length - 1] === 42; };

export async function run() {
  const { chunkedCache } = await import('/src/engine/model-cache.js?' + Date.now());
  const NAME = 'qa-model-cache-test';
  await caches.delete(NAME);
  const cache = chunkedCache(NAME);
  const url = 'https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/main/onnx/encoder_model_q4f16.onnx';
  const res = await runTests([
    ['plain Cache Storage refuses a 353 MiB entry (the bug)', async () => {
      const c = await caches.open(NAME);
      let failed = false; try { await c.put('/plain-353', new Response(bytes(353 * MiB))); } catch { failed = true; }
      await c.delete('/plain-353');
      assert(failed, 'expected Chromium to refuse a single 353 MiB entry');
    }],
    ['353 MiB file is stored in parts and read back byte-identical', async () => {
      const src = bytes(Math.round(352.8 * MiB));
      await cache.put(url, new Response(src, { headers: { 'content-length': String(src.length), 'content-type': 'application/octet-stream' } }));
      const r = await cache.match(url);
      assert(r, 'cached entry found');
      eq(r.headers.get('content-length'), String(src.length), 'content-length restored');
      assert(await same(r, src), 'bytes identical');
    }],
    ['small files stay single entries (unchanged behaviour)', async () => {
      const src = bytes(3 * MiB);
      await cache.put('https://huggingface.co/x/config.json', new Response(src, { headers: { 'content-length': String(src.length) } }));
      const c = await caches.open(NAME);
      const raw = await c.match('https://huggingface.co/x/config.json');
      assert(raw && !raw.headers.get('x-sparkscribe-parts'), 'stored as one plain entry');
      assert(await same(await cache.match('https://huggingface.co/x/config.json'), src), 'read back');
    }],
    ['entries cached by the old code (plain) are still matched', async () => {
      const c = await caches.open(NAME);
      const src = bytes(1 * MiB, 3);
      await c.put('https://huggingface.co/y/decoder.onnx', new Response(src));
      assert(await same(await cache.match('https://huggingface.co/y/decoder.onnx'), src), 'legacy entry readable');
    }],
    ['a missing part means "not cached" (downloaded again), never a corrupt file', async () => {
      const c = await caches.open(NAME);
      const keys = (await c.keys()).map((r) => r.url).filter((u) => u.includes('sparkscribe-part=1'));
      assert(keys.length === 1, 'part 1 exists');
      await c.delete(keys[0]);
      eq(await cache.match(url), undefined, 'damaged set treated as missing');
    }],
    ['a miss returns undefined', async () => { eq(await cache.match('https://huggingface.co/nope'), undefined, 'miss'); }],
  ]);
  await caches.delete(NAME);
  return res;
}
