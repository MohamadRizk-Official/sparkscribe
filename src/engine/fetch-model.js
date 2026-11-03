// Model files the app loads itself (not through transformers.js): downloaded once, kept in this browser's Cache
// Storage (in parts when large, engine/model-cache.js), and checked against a known SHA-256 before use, so a damaged or
// changed file is never run (it is downloaded again instead). Files come from a pinned Hugging Face commit.
//   cachedModel(url, sha256, { onProgress }) -> ArrayBuffer
import { chunkedCache } from './model-cache.js';

const cache = typeof caches !== 'undefined' ? chunkedCache('sparkscribe-models') : null;

async function sha256Hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function download(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`model download failed (${res.status})`);
  const total = Number(res.headers.get('content-length') || 0);
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.({ status: 'progress', file: url.split('/').pop(), loaded: got, total, progress: total ? (got / total) * 100 : 0 });
  }
  onProgress?.({ status: 'done', file: url.split('/').pop() });
  const out = new Uint8Array(got);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out.buffer;
}

export async function cachedModel(url, sha256, { onProgress } = {}) {
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        const buf = await hit.arrayBuffer();
        if (await sha256Hex(buf) === sha256) return buf;
      }
    } catch { /* a broken entry: download again */ }
  }
  const buf = await download(url, onProgress);
  if (await sha256Hex(buf) !== sha256) throw new Error(`model file ${url.split('/').pop()} did not match its checksum`);
  if (cache) { try { await cache.put(url, new Response(buf, { headers: { 'content-length': String(buf.byteLength) } })); } catch { /* storage full: still usable now */ } }
  return buf;
}

// downloaded (and checked) into the browser cache now, read into memory only where it is used: a file already cached is
// not opened at all
export async function prefetchModel(url, sha256, { onProgress } = {}) {
  if (cache && (await cache.has(url))) return;
  await cachedModel(url, sha256, { onProgress });
}
