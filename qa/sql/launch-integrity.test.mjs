// SQL tests of the launch-integrity migration (supabase/migrations/20261015100000_launch_integrity.sql) on an
// isolated Postgres with every production migration applied, then its rollback. No network, no production data.
//   node qa/sql/launch-integrity.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDb } from './pg.mjs';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const rejects = async (p, re, m) => { let err = null; try { await p; } catch (e) { err = e; } ok(err && re.test(err.message), `${m} (${err ? err.message.slice(0, 70) : 'no error'})`); };

const P = await freshDb({ proposed: true });
ok(P.applied.some((n) => n.includes('launch_integrity')), 'the migration applies on top of every production migration');
const { db } = P;
await db.query(`update public.billing_settings set metering_starts_at = now() - interval '1 day', enforce_quota = true`);
const a = await P.createUser('a@example.com'), b = await P.createUser('b@example.com');
const usageRows = async (uid) => (await db.query('select count(*)::int n, coalesce(sum(seconds), 0)::int s from public.usage where user_id = $1', [uid])).rows[0];
const seg = JSON.stringify([{ s: 0, e: 600, sp: 'Speaker 1', t: 'a lecture about cells and membranes' }]);

// ---- 1. a retried save with the same id is one recording, counted once ----
const id = '11111111-2222-4333-8444-555555555555';
const insert = (uid, rid) => P.asUser(uid, (d) => d.query(`insert into public.transcriptions (id, title, transcript_text, duration_seconds, segments) values ($1, 'Lecture', 'x', 600, $2) returning id`, [rid, seg]));
ok((await insert(a, id)).rows[0].id === id, 'the browser can choose the recording id');
await rejects(insert(a, id), /duplicate key|transcriptions_pkey/, 'a retry with the same id is refused by the primary key (the app treats it as already saved)');
const u = await usageRows(a);
ok(u.n === 1 && u.s === 600, `minutes are counted once (${u.n} row, ${u.s} s)`);
const own = await P.asUser(a, (d) => d.query('select count(*)::int n from public.transcriptions where id = $1', [id]));
ok(own.rows[0].n === 1, 'and the library has one copy');
await rejects(insert(b, id), /duplicate key|transcriptions_pkey/, "another user can't take over an id that exists");
ok((await P.asUser(b, (d) => d.query('select count(*)::int n from public.transcriptions where id = $1', [id]))).rows[0].n === 0, "…nor read the other person's recording through it");

// ---- 2. editing the text can't add unbilled time ----
const noSeg = (await P.asUser(a, (d) => d.query(`insert into public.transcriptions (title, transcript_text, duration_seconds) values ('Note', 'hello there', 1) returning id`))).rows[0].id;
const hours = Array.from({ length: 20000 }, () => 'word').join(' ');
await rejects(P.asUser(a, (d) => d.query('update public.transcriptions set transcript_text = $1 where id = $2', [hours, noSeg])), /recording_length_locked/, 'replacing a 1-second note with hours of text is refused');
await P.asUser(a, (d) => d.query(`update public.transcriptions set transcript_text = 'hello there, Sam' where id = $1`, [noSeg]));
ok((await db.query('select transcript_text from public.transcriptions where id = $1', [noSeg])).rows[0].transcript_text === 'hello there, Sam', 'an ordinary correction (a name, a word) still saves');
await P.asUser(a, (d) => d.query(`update public.transcriptions set transcript_text = $1 where id = $2`, ['renamed speaker text that is long but billed by its segments', id]));
ok(true, 'a recording with line timestamps is billed by its segments, so editing its text is never refused');

// ---- 3. billing status: only what a customer needs ----
const st = (await P.asUser(a, (d) => d.query('select public.billing_status() r'))).rows[0].r;
ok(!('enforceOrigins' in st) && !('enforceQuota' in st), 'billing_status no longer exposes the enforcement switches or Preview origins');
ok(['plan', 'monthlySeconds', 'usedSeconds', 'remainingSeconds', 'periodEnd', 'enforced'].every((k) => k in st), 'it still returns plan, allowance, used, remaining, renewal and whether limits apply');

// ---- 4. Library search: Notes snippets show names, not codes ----
await db.query(`insert into public.transcription_insights (transcription_id, user_id, kind, recording_type, status, content, source_version)
  select $1, $2, 'notes', 'lecture', 'ready', $3::jsonb, content_version from public.transcriptions where id = $1`,
  [id, a, JSON.stringify({ speakers: { S1: { name: 'Professor Ahmad', lines: [[0, 0]] } }, sections: [{ heading: 'Cells', items: [{ text: '{{S1}} explained osmosis across the membrane', refs: [0] }] }] })]);
const hits = (await P.asUser(a, (d) => d.query(`select public.search_library('osmosis') r`))).rows[0].r;
const notes = JSON.stringify(hits);
ok(/Professor Ahmad/.test(notes) && !/\{\{S1\}\}/.test(notes), 'a Notes snippet shows the speaker name, not {{S1}}');

// ---- rollback ----
await db.exec(readFileSync(new URL('../../supabase/proposed/rollback/20261015100000_launch_integrity.down.sql', import.meta.url), 'utf8'));
await rejects(P.asUser(a, (d) => d.query(`insert into public.transcriptions (id, title, transcript_text) values ('99999999-2222-4333-8444-555555555555', 't', 'x')`)), /permission denied/, 'rollback: choosing an id is not allowed again');
const st2 = (await P.asUser(a, (d) => d.query('select public.billing_status() r'))).rows[0].r;
ok('enforceOrigins' in st2 && (await db.query(`select to_regprocedure('public.resolve_speaker_codes(text,jsonb)') is null x`)).rows[0].x, 'rollback restores the previous functions');
console.log(`\n${pass} checks passed`);
