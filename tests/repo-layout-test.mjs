// Repository layout (read-only checks): migrations are named and ordered the way the database tools expect, every
// function named in vercel.json exists, every page the build lists exists, and every API file has a default handler.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const root = new URL('../', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');

// ---- supabase/migrations
const migrations = readdirSync(new URL('supabase/migrations/', root)).filter((f) => !f.startsWith('.'));
ok(migrations.length >= 15, `there are migrations (${migrations.length})`);
ok(migrations.every((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f)), 'every migration is <14-digit timestamp>_<snake_case_name>.sql');
const stamps = migrations.map((f) => f.slice(0, 14));
ok(new Set(stamps).size === stamps.length, 'no two migrations share a timestamp');
// (the hour part is not checked: 20261017300000 reads as hour 30, which is harmless because only the order of the numbers matters)
ok(stamps.every((s) => +s.slice(4, 6) >= 1 && +s.slice(4, 6) <= 12 && +s.slice(6, 8) >= 1 && +s.slice(6, 8) <= 31), 'every timestamp starts with a real year, month and day');
ok(stamps.every((s) => +s.slice(0, 4) >= 2026), 'every timestamp is from 2026 or later');
ok([...stamps].sort().join() === stamps.join(), 'the files list in the order they would be applied');
ok(migrations.every((f) => read(`supabase/migrations/${f}`).trim().length > 50), 'no migration is empty');
const proposed = readdirSync(new URL('supabase/proposed/', root)).filter((f) => f.endsWith('.sql'));
ok(proposed.every((f) => !migrations.includes(f)), 'a proposed migration is not also in migrations/ under the same name');
ok(proposed.every((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f)), 'proposed migrations follow the same naming');

// ---- vercel.json
const vercel = JSON.parse(read('vercel.json'));
ok(vercel.cleanUrls === true, 'clean URLs are on (/library serves library.html)');
const apiFiles = readdirSync(new URL('api/', root)).filter((f) => f.endsWith('.js'));
for (const pattern of Object.keys(vercel.functions || {})) {
  const names = pattern.match(/^api\/\{([^}]+)\}\.js$/)?.[1].split(',') || [pattern.replace(/^api\//, '').replace(/\.js$/, '')];
  ok(names.every((n) => apiFiles.includes(`${n}.js`)), `vercel.json function settings name real files: ${pattern}`);
}
ok(Object.values(vercel.functions).every((f) => f.maxDuration >= 10 && f.maxDuration <= 300), 'function time limits are between 10 and 300 seconds');
const headers = vercel.headers.find((h) => h.source === '/(.*)').headers;
const header = (k) => headers.find((h) => h.key === k)?.value;
ok(header('X-Content-Type-Options') === 'nosniff' && header('X-Frame-Options') === 'DENY', 'every page is sent with nosniff and X-Frame-Options DENY');
ok(header('Content-Security-Policy') === "frame-ancestors 'none'", 'the enforced policy forbids framing the site');
ok(/object-src 'none'/.test(header('Content-Security-Policy-Report-Only')) && /base-uri 'self'/.test(header('Content-Security-Policy-Report-Only')), 'the report-only policy forbids plugins and foreign <base> tags');
ok(header('Permissions-Policy').includes('camera=()') && header('Permissions-Policy').includes('payment=()'), 'camera and payment are switched off for the page');
ok(vercel.headers.some((h) => h.source === '/assets/(.*)' && h.headers.some((x) => /immutable/.test(x.value))), 'hashed assets are cached as immutable');
ok(vercel.headers.some((h) => h.source === '/api/(.*)' && h.headers.some((x) => x.key === 'X-Robots-Tag' && x.value === 'noindex')), 'API responses are noindex');

// ---- api/ handlers
for (const f of apiFiles) ok(/^export default /m.test(read(`api/${f}`)), `api/${f} has a default export (the Vercel handler)`);

// ---- vite.config.js pages
const cfg = read('vite.config.js');
const pageFiles = [...cfg.matchAll(/:\s*'([\w/-]+\.html)'/g)].map((m) => m[1]);
ok(pageFiles.length >= 10 && pageFiles.every((p) => existsSync(new URL(p, root))), `every page the build lists exists (${pageFiles.length})`);
const clean = [...cfg.match(/const cleanRoutes = new Set\(\[([^\]]*)\]/)[1].matchAll(/'(\/[\w/-]*)'/g)].map((m) => m[1]);
ok(clean.every((r) => pageFiles.includes(`${r.slice(1)}.html`)), 'every clean route maps to a listed page');

console.log(`\n${pass} checks passed`);
