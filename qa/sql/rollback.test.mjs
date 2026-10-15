// The proposed migrations can be rolled back and re-applied cleanly on a database with every production migration.
//   node qa/sql/rollback.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDb } from './pg.mjs';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const file = (p) => readFileSync(new URL(`../../supabase/proposed/${p}`, import.meta.url), 'utf8');
const applied = (p) => readFileSync(new URL(`../../supabase/migrations/${p}`, import.meta.url), 'utf8'); // applied: account deletion 2026-10-14, AI limits 2026-10-15
const P = await freshDb({ proposed: true });
const { db } = P;
const exists = async (sql) => (await db.query(`select ${sql} as x`)).rows[0].x;
const objects = async () => ({
  reserve: await exists(`to_regprocedure('public.ai_reserve(text,integer,text)') is not null`),
  usage: await exists(`to_regclass('public.ai_usage') is not null`),
  col: await exists(`exists (select 1 from information_schema.columns where table_name = 'billing_settings' and column_name = 'enforce_ai_limits')`),
  del: await exists(`to_regprocedure('public.delete_my_account(text)') is not null`),
  queue: await exists(`to_regclass('private.account_deletions') is not null`),
});
const u = await P.createUser('keep@example.com');
await P.asUser(u, (d) => d.query(`insert into public.transcriptions (title, transcript_text, duration_seconds) values ('kept', 'x', 5)`));
ok(Object.values(await objects()).every(Boolean), 'the AI-limits proposal and the account-deletion migration are both in place');

await db.exec(file('rollback/20261012100000_ai_usage_limits.down.sql'));
await db.exec(file('rollback/20261012110000_account_deletion.down.sql'));
const after = await objects();
ok(!after.reserve && !after.usage && !after.col && !after.del && after.queue, `rolled back (deletion queue kept on purpose): ${JSON.stringify(after)}`);
ok((await db.query('select count(*)::int n from public.transcriptions')).rows[0].n === 1 && (await db.query('select count(*)::int n from auth.users')).rows[0].n === 1, 'user content and accounts untouched');

await db.exec(applied('20261012100000_ai_usage_limits.sql'));
await db.exec(applied('20261012110000_account_deletion.sql'));
ok(Object.values(await objects()).every(Boolean), 're-applying both migrations after a rollback works');
console.log(`\n${pass} checks passed`);
