// QA ONLY: serve the production build (dist/) on 127.0.0.1 with the site's security headers, plus a switch that
// makes the converter download stall part-way — to test what a user sees when the ~32 MB FFmpeg download stops.
//   node qa/harness/static-stall.mjs [port=4312]
//   GET /__stall?on=1   → /ffmpeg/ffmpeg-core.wasm sends 1 MB, then nothing (connection left open)
//   GET /__stall?on=0   → normal
// Serves only files under dist/. No Supabase or AI calls are made by this server.
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(process.argv[1], '../../../dist');
const PORT = Number(process.argv[2]) || 4312;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.onnx': 'application/octet-stream' };
const vercel = JSON.parse(readFileSync(resolve(ROOT, '../vercel.json'), 'utf8'));
const HEADERS = Object.fromEntries((vercel.headers?.find((h) => h.source === '/(.*)')?.headers || []).map((h) => [h.key, h.value]));
let stall = false;

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__stall') { stall = url.searchParams.get('on') === '1'; return res.end(`stall=${stall}`); }
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  let file = normalize(join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  if (!existsSync(file) && existsSync(file + '.html')) file += '.html';           // clean URLs like Vercel
  if (!existsSync(file) || statSync(file).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  for (const [k, v] of Object.entries(HEADERS)) res.setHeader(k, v);
  res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
  if (stall && p === '/ffmpeg/ffmpeg-core.wasm') {
    res.setHeader('Content-Length', statSync(file).size);
    const s = createReadStream(file, { end: 1024 * 1024 - 1 });
    s.on('data', (c) => res.write(c));                                      // ...and never end()
    req.on('close', () => s.destroy());
    return;
  }
  res.setHeader('Content-Length', statSync(file).size);
  createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`static (stall switch) on http://127.0.0.1:${PORT}`));
