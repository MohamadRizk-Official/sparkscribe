// Documentation links (read-only): every relative Markdown link under docs/ points at a file that exists, and every
// source or test path written in backticks in the top-level docs exists. Keeps the docs honest when files move.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const root = fileURLToPath(new URL('../', import.meta.url));
const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const docs = walk(join(root, 'docs')).filter((f) => f.endsWith('.md'));
ok(docs.length > 50, `there are docs to check (${docs.length})`);

const broken = [];
let links = 0;
for (const file of docs) {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    links++;
    const path = resolve(dirname(file), decodeURIComponent(target.split('#')[0]));
    if (!existsSync(path)) broken.push(`${file.slice(root.length)} -> ${target}`);
  }
}
ok(links > 50, `relative links were found (${links})`);
ok(broken.length === 0, `every relative link points at an existing file${broken.length ? ` (broken: ${broken.join('; ')})` : ''}`);

const missing = [];
for (const name of ['TESTING.md', 'PROJECT-CONTEXT.md', 'ENVIRONMENT-VARIABLES.md', 'DATABASE-MIGRATIONS.md', 'FOUND-ISSUES.md']) {
  const file = join(root, 'docs', name);
  if (!existsSync(file)) continue;
  for (const m of readFileSync(file, 'utf8').matchAll(/`((?:src|server|api|tests|supabase)\/[\w./-]+\.(?:js|mjs|sql))`/g)) {
    if (!existsSync(join(root, m[1]))) missing.push(`${name}: ${m[1]}`);
  }
}
ok(missing.length === 0, `source paths named in the top-level docs exist${missing.length ? ` (missing: ${missing.join('; ')})` : ''}`);

console.log(`\n${pass} checks passed`);
