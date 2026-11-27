// docs/ENVIRONMENT-VARIABLES.md stays complete (read-only): every variable the server and browser code reads
// (process.env.X in server/ and api/, import.meta.env.X in src/) is named in the reference, and the reference names no
// variable the code has stopped reading.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const root = fileURLToPath(new URL('../', import.meta.url));
const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const js = (dir) => walk(join(root, dir)).filter((f) => /\.(js|mjs)$/.test(f));
const doc = readFileSync(join(root, 'docs/ENVIRONMENT-VARIABLES.md'), 'utf8');
const documented = new Set([...doc.matchAll(/\b([A-Z][A-Z0-9_]{3,}(?:<PLAN>[A-Z0-9_]*)?)/g)].map((m) => m[1]));

const read = new Set();
for (const f of [...js('server'), ...js('api')]) for (const m of readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) read.add(m[1]);
for (const f of js('src')) for (const m of readFileSync(f, 'utf8').matchAll(/import\.meta\.env\??\.([A-Z][A-Z0-9_]+)/g)) if (!['DEV', 'PROD', 'MODE', 'BASE_URL', 'SSR'].includes(m[1])) read.add(m[1]);
ok(read.size >= 30, `the code reads many variables (${read.size})`);

const undocumented = [...read].filter((v) => !documented.has(v));
ok(undocumented.length === 0, `every variable the code reads is in the reference${undocumented.length ? ` (missing: ${undocumented.join(', ')})` : ''}`);

// names built from parts in the code are documented as patterns
for (const pattern of ['STRIPE_<PLAN>_PRICE_ID', 'STRIPE_<PLAN>_YEARLY_PRICE_ID', 'STRIPE_<PLAN>_INTRO_COUPON']) ok(documented.has(pattern), `the built-up name ${pattern} is documented`);

// a documented name must still appear somewhere in the code (variables read through `env.X` in server/billing/config.js count)
const source = [...js('server'), ...js('api'), ...js('src'), join(root, 'vite.config.js')].map((f) => readFileSync(f, 'utf8')).join('\n');
const skip = new Set(['VITE_', 'NEXT_PUBLIC_', 'FLASH', 'BOLT', 'THUNDER', 'SPEAKER_DOUBLE_CHECK']);
const stale = [...documented].filter((v) => !skip.has(v) && !v.includes('<PLAN>') && !new RegExp(`\\b${v}\\b`).test(source));
ok(stale.length === 0, `the reference names no variable the code no longer reads${stale.length ? ` (stale: ${stale.join(', ')})` : ''}`);
ok(!/\bsk_(test|live)_[A-Za-z0-9]{6,}/.test(doc) && !/\bwhsec_[A-Za-z0-9]{6,}/.test(doc), 'the reference contains no key or secret values');

console.log(`\n${pass} checks passed`);
