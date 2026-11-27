// Migration rollbacks (read-only): from the AI usage limits migration on, every migration has a matching rollback
// file in supabase/proposed/rollback/, a migration that mentions its rollback names the right file, and every rollback belongs to a migration.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const root = new URL('../supabase/', import.meta.url);
const FIRST_WITH_ROLLBACK = '20261012100000';
const migrations = readdirSync(new URL('migrations/', root)).filter((f) => f.endsWith('.sql'));
const downs = readdirSync(new URL('proposed/rollback/', root)).filter((f) => f.endsWith('.down.sql'));
const needing = migrations.filter((f) => f.slice(0, 14) >= FIRST_WITH_ROLLBACK);

ok(needing.length >= 9, `${needing.length} migrations are expected to have a rollback`);
for (const m of needing) {
  const base = m.replace(/\.sql$/, '');
  ok(downs.includes(`${base}.down.sql`), `${base} has a rollback file`);
  const text = readFileSync(new URL(`migrations/${m}`, root), 'utf8');
  // course_exams has a rollback file but does not mention it; the others name it in their header
  if (text.includes("supabase/proposed/rollback/")) ok(text.includes(`supabase/proposed/rollback/${base}.down.sql`), `${base} names its own rollback file, not another one`);
}
const orphans = downs.filter((d) => !migrations.includes(d.replace(/\.down\.sql$/, '.sql')));
ok(orphans.length === 0, `every rollback file belongs to a migration${orphans.length ? ` (orphans: ${orphans.join(', ')})` : ''}`);
for (const d of downs) {
  const text = readFileSync(new URL(`proposed/rollback/${d}`, root), 'utf8');
  ok(text.trim().length > 20 && /\b(drop|delete|alter|update|revoke|create or replace)\b/i.test(text), `${d} contains statements, not just a comment`);
}

console.log(`\n${pass} checks passed`);
