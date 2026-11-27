// Import paths (read-only): every relative import in src/, server/ and api/ names a file that exists, and the server
// and API code never imports from the browser-only folders that need a DOM (src/pages, src/main.js, src/mascot, src/electric, src/library, src/home).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve, relative } from 'node:path';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const root = fileURLToPath(new URL('../', import.meta.url));
const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = ['src', 'server', 'api'].flatMap((d) => walk(join(root, d))).filter((f) => /\.(js|mjs)$/.test(f));
ok(files.length > 100, `there are source files to check (${files.length})`);

const missing = [];
const crossing = [];
let count = 0;
const browserOnly = /^(src\/pages\/|src\/main\.js|src\/mascot\/|src\/electric\/|src\/library\/|src\/home\/|src\/worker\.js|src\/align-worker\.js)/;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"\n;]*?from\s+['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|(?:^|\n)\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const spec = (m[1] || m[2] || m[3]).split('?')[0];
    if (/\.(css|svg|png|json|wasm|onnx)$/.test(spec)) { if (!existsSync(resolve(dirname(file), spec))) missing.push(`${relative(root, file)} -> ${spec}`); count++; continue; }
    count++;
    const target = resolve(dirname(file), spec);
    if (!existsSync(target) || statSync(target).isDirectory()) { missing.push(`${relative(root, file)} -> ${spec}`); continue; }
    const from = relative(root, file), to = relative(root, target);
    if (/^(server|api)\//.test(from) && browserOnly.test(to)) crossing.push(`${from} -> ${to}`);
  }
}
ok(count > 200, `many relative imports were found (${count})`);
ok(missing.length === 0, `every relative import points at an existing file${missing.length ? ` (missing: ${missing.join('; ')})` : ''}`);
ok(crossing.length === 0, `server and api code import nothing from browser-only code${crossing.length ? ` (found: ${crossing.join('; ')})` : ''}`);

console.log(`\n${pass} checks passed`);
