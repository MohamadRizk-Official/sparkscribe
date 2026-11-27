// package.json (read-only): every file a script runs exists, the SQL scenarios cover each migration that has a rollback,
// and the libraries that build downloadable files or talk to Stripe are pinned to one exact version.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

ok(pkg.type === 'module' && pkg.private === true, 'the package is private and uses ES modules');
const missing = [];
let refs = 0;
for (const [name, cmd] of Object.entries(pkg.scripts)) {
  for (const m of cmd.matchAll(/\bnode\s+([\w./-]+\.mjs)/g)) { refs++; if (!existsSync(join(root, m[1]))) missing.push(`${name}: ${m[1]}`); }
}
ok(refs > 100, `scripts run many files (${refs})`);
ok(missing.length === 0, `every file a script runs exists${missing.length ? ` (missing: ${missing.join('; ')})` : ''}`);

for (const name of ['dev', 'build', 'preview', 'test', 'test:sql']) ok(typeof pkg.scripts[name] === 'string' && pkg.scripts[name].length > 3, `the "${name}" script is defined`);
ok(pkg.scripts.build === 'vite build' && pkg.scripts.dev === 'vite', 'dev and build are plain Vite');
ok(!/\b(sk|rk)_(test|live)_|whsec_|eyJ[A-Za-z0-9_-]{20,}/.test(JSON.stringify(pkg)), 'package.json holds no keys or tokens');

// every migration from the AI-limits one on has a SQL scenario named after it
const sqlScenarios = pkg.scripts['test:sql'].split('&&').map((s) => s.trim().replace(/^node qa\/sql\//, '').replace(/\.test\.mjs$/, ''));
const names = readdirSync(join(root, 'supabase/migrations')).filter((f) => f.slice(0, 14) >= '20261012100000').map((f) => f.slice(15, -4).replace(/_/g, '-')).map((n) => ({ 'ai-usage-limits': 'ai-limits' })[n] || n); // the AI limits scenario is named ai-limits
const uncovered = names.filter((n) => !sqlScenarios.includes(n));
ok(uncovered.length === 0, `each recent migration has a SQL scenario in test:sql${uncovered.length ? ` (none for: ${uncovered.join(', ')})` : ''}`);
ok(new Set(sqlScenarios).size === sqlScenarios.length, 'no SQL scenario is listed twice');

// exact pins
for (const dep of ['docx', 'jspdf', 'stripe']) ok(/^\d+\.\d+\.\d+$/.test(pkg.dependencies[dep]), `${dep} is pinned to one exact version (${pkg.dependencies[dep]})`);
ok(Object.values({ ...pkg.dependencies, ...pkg.devDependencies }).every((v) => !/^(\*|latest|)$/.test(v)), 'no dependency uses "*" or "latest"');

console.log(`\n${pass} checks passed`);
