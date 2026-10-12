// Model-file cache for transformers.js (env.customCache). Same browser Cache Storage as before, one difference:
// Chromium (Chrome, Edge) refuses a single cache entry larger than 256 MiB ("Unexpected internal error"), so the
// 353 MiB Whisper large-v3-turbo encoder was never stored and was downloaded again on every visit. Large files are
// stored as parts of at most PART_BYTES plus a small index entry written LAST: a half-written set of parts is never
// matched, and a damaged one is treated as missing (the file is simply downloaded again). Entries stored by older
// versions (plain, one piece) keep working unchanged.
export const PART_BYTES = 128 * 1024 * 1024;
const PARTS = 'x-sparkscribe-parts';
const SIZE = 'x-sparkscribe-size';

const keyOf = (k) => (typeof k === 'string' ? k : k.url);
// Cache Storage ignores URL fragments when matching, so parts are told apart by a query parameter
const partKey = (key, i) => `${key}${key.includes('?') ? '&' : '?'}sparkscribe-part=${i}`;

export function chunkedCache(cacheName = 'transformers-cache', { partBytes = PART_BYTES } = {}) {
  const open = () => caches.open(cacheName);
  return {
    async match(request) {
      const key = keyOf(request);
      const c = await open();
      const head = await c.match(key);
      if (!head) return undefined;
      const parts = Number(head.headers.get(PARTS) || 0);
      if (!parts) return head; // a normal, single-piece entry
      const blobs = [];
      for (let i = 0; i < parts; i++) {
        const p = await c.match(partKey(key, i));
        if (!p) return undefined;
        blobs.push(await p.blob());
      }
      const blob = new Blob(blobs);
      if (String(blob.size) !== head.headers.get(SIZE)) return undefined;
      const headers = new Headers(head.headers);
      headers.delete(PARTS); headers.delete(SIZE);
      headers.set('content-length', String(blob.size));
      return new Response(blob, { status: 200, headers });
    },
    async put(request, response) {
      const key = keyOf(request);
      const c = await open();
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared && declared <= partBytes) return c.put(key, response);
      const blob = await response.blob();
      if (blob.size <= partBytes) return c.put(key, new Response(blob, { status: 200, headers: response.headers }));
      const n = Math.ceil(blob.size / partBytes);
      await c.delete(key); // never leave an old index pointing at new parts
      for (let i = 0; i < n; i++) await c.put(partKey(key, i), new Response(blob.slice(i * partBytes, (i + 1) * partBytes)));
      const headers = new Headers(response.headers);
      headers.set(PARTS, String(n)); headers.set(SIZE, String(blob.size)); headers.set('content-length', '0');
      await c.put(key, new Response(null, { status: 200, headers }));
    },
  };
}
