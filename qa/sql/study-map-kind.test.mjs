// Study map kind (20261027110000_study_map_kind.sql), on an isolated Postgres with every migration: a recording's
// owner can save a 'study_map' result like any other (same Row Level Security), unknown kinds are still refused,
// nobody can save one on someone else's recording, and rollback removes the maps and restores the old list.
//   node qa/sql/study-map-kind.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDb } from './pg.mjs';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const rejects = async (p, re, m) => { let err = null; try { await p; } catch (e) { err = e; } ok(err && re.test(`${err.code} ${err.message}`), `${m} (${err ? `${err.code} ${err.message}`.slice(0, 70) : 'no error'})`); };
const MIG = '20261027110000_study_map_kind.sql';
const file = (p) => readFileSync(new URL(`../../supabase/${p}`, import.meta.url), 'utf8');

const P = await freshDb({ only: (n) => n < MIG });
const { db } = P;
const a = await P.createUser('a@example.com'), b = await P.createUser('b@example.com');
const t = await P.asUser(a, async (d) => (await d.query(`insert into public.transcriptions (title, transcript_text, duration_seconds) values ('t', 'x', 10) returning id`)).rows[0].id);
const add = (uid, kind, key = 'g2') => P.asUser(uid, (d) => d.query(`insert into public.transcription_artifacts (transcription_id, kind, settings_key, source_version, status) values ($1, $2, $3, 1, 'ready')`, [t, kind, key]));

await rejects(add(a, 'study_map'), /check constraint|violates/, 'before: a study map is not an allowed kind');
await db.exec(file(`migrations/${MIG}`));
await add(a, 'study_map');
ok(true, 'the owner can save a study map for their recording');
await add(a, 'quiz');
ok(true, 'other kinds still work');
await rejects(add(a, 'bogus', 'x'), /check constraint|violates/, 'unknown kinds are still refused');
await rejects(add(b, 'study_map', 'other'), /row-level security|violates/, "nobody can save one on someone else's recording");

await db.exec(file(`proposed/rollback/${MIG.replace('.sql', '.down.sql')}`));
ok((await db.query(`select count(*)::int n from public.transcription_artifacts where kind = 'study_map'`)).rows[0].n === 0, 'rollback: the stored maps are removed');
ok((await db.query(`select count(*)::int n from public.transcription_artifacts where kind = 'quiz'`)).rows[0].n === 1, 'rollback: other results are kept');
await rejects(add(a, 'study_map', 'g3'), /check constraint|violates/, 'rollback: the old list is back');
await db.exec(file(`migrations/${MIG}`));
ok(true, 'the migration applies again after a rollback');

console.log(`\n${pass} checks passed`);
