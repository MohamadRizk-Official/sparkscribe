// Re-score saved results (no model calls): node qa/ai-eval/remeasure.mjs [dir] [--private]
// Recomputes every <case>.<engine>.<kind>.json with the current metrics and rewrites summary.json.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES } from './fixtures.mjs';
import { measure } from './metrics.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : resolve(ROOT, 'qa/out/ai-eval'));
const rows = [];
for (const f of readdirSync(dir).filter((x) => /^[\w-]+\.(old|new)\.(flashcards|quiz)\.json$/.test(x)).sort()) {
  const [id, engine, kind] = f.split('.');
  const saved = JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
  const kase = CASES.find((c) => c.id === id) || {};
  const row = { ...saved.row, ...(saved.content ? measure(kind, saved.content, kase) : {}), case: id, engine, kind };
  writeFileSync(resolve(dir, f), JSON.stringify({ row, content: saved.content }, null, 1));
  rows.push(row);
}
writeFileSync(resolve(dir, 'summary.json'), JSON.stringify(rows, null, 1));
console.log(`re-scored ${rows.length} results in ${dir}`);
