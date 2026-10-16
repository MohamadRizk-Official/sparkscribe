// Master Phase 2 access paths under Row Level Security, on an isolated Postgres with every production migration
// (no network, no production data). The new features add no tables; this checks the exact queries they make:
//   * Across recordings reads transcripts / overviews / study maps by id, as the user (server/db.js);
//   * Focused Review writes `progress` (browser) and appends follow-ups to `content` (server, as the user);
//   * the one-at-a-time guard reads the user's own ai_usage rows.
//   node qa/sql/study-intelligence.test.mjs
import assert from 'node:assert/strict';
import { freshDb } from './pg.mjs';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

const P = await freshDb({ proposed: true });
const { db } = P;
const a = await P.createUser('a@example.com'), b = await P.createUser('b@example.com');
const seg = JSON.stringify([{ s: 0, e: 30, sp: 'Speaker 1', t: 'Osmosis is the passive movement of water.' }]);
const rec = async (uid, title) => (await P.asUser(uid, (d) => d.query(`insert into public.transcriptions (title, transcript_text, duration_seconds, segments) values ($1, 'x', 30, $2) returning id, content_version`, [title, seg]))).rows[0];
const [a1, a2] = [await rec(a, 'Lecture 2'), await rec(a, 'Lecture 5')];
const b1 = await rec(b, 'B private');
// a stored overview and a quiz with a study map, as the app creates them
await P.asUser(a, (d) => d.query(`insert into public.transcription_insights (transcription_id, kind, recording_type, status, content, source_version) values ($1, 'overview', 'general', 'ready', '{"short_summary":"s","key_points":[]}', $2)`, [a1.id, a1.content_version]));
const quiz = (await P.asUser(a, (d) => d.query(`insert into public.transcription_artifacts (transcription_id, kind, settings_key, status, content, source_version) values ($1, 'quiz', 'x', 'ready', $2, $3) returning id, updated_at`,
  [a1.id, JSON.stringify({ engine: 3, map: { topics: [], concepts: [{ id: 'c1' }] }, questions: [{ concept: 'c1', question: 'Q?' }] }), a1.content_version]))).rows[0];

// ---- reading a collection by id ----
const byIds = (uid, ids) => P.asUser(uid, (d) => d.query('select id, title, created_at, content_version from public.transcriptions where id = any($1::uuid[])', [ids]));
ok((await byIds(a, [a1.id, a2.id])).rows.length === 2, "a user reads their own recordings by id (with created_at for the recording order)");
const mixed = (await byIds(a, [a1.id, b1.id])).rows;
ok(mixed.length === 1 && mixed[0].id === a1.id, "another user's id in the selection simply doesn't exist for them (the server reports it as unavailable)");
ok((await byIds(b, [a1.id, a2.id])).rows.length === 0, "guessing someone else's ids returns nothing");
ok((await P.asUser(b, (d) => d.query('select count(*)::int n from public.transcription_insights where transcription_id = $1', [a1.id]))).rows[0].n === 0, "…nor their stored overviews");
ok((await P.asUser(b, (d) => d.query('select count(*)::int n from public.transcription_artifacts where transcription_id = $1', [a1.id]))).rows[0].n === 0, "…nor their study maps and quizzes");
let anon = null; try { await P.asAnon((d) => d.query('select count(*)::int n from public.transcriptions')); } catch (e) { anon = e; }
ok(anon?.code === '42501', 'signed out: refused outright (no access to recordings at all)');

// ---- Focused Review writes ----
const progress = JSON.stringify({ last_score: 0, total: 1, review: { v: 1, c: { c1: { s: 'review', m: 1, ok: 0, q: [0], t: 1 } }, flag: [] } });
ok((await P.asUser(a, (d) => d.query('update public.transcription_artifacts set progress = $2 where id = $1 returning id', [quiz.id, progress]))).rows.length === 1, 'the learner saves their review state in their own quiz progress');
ok((await P.asUser(b, (d) => d.query('update public.transcription_artifacts set progress = $2 where id = $1 returning id', [quiz.id, '{}']))).rows.length === 0, "another user can't change it");
const big = JSON.stringify({ review: { v: 1, c: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`c${i}`, { s: 'review', m: 1, ok: 0, q: [1, 2, 3, 4], t: 1792111111 }])) } });
let tooBig = null; try { await P.asUser(a, (d) => d.query('update public.transcription_artifacts set progress = $2 where id = $1', [quiz.id, big])); } catch (e) { tooBig = e; }
ok(tooBig, 'progress stays bounded by the database (4000 bytes): the browser compacts the review to fit');
// follow-ups: content appended only if nobody changed the quiz since it was read (optimistic, like server/db.js)
const append = (uid, updatedAt) => P.asUser(uid, (d) => d.query(`update public.transcription_artifacts set content = content || '{"followups":[{"concept":"c1","question":"F?"}]}' where id = $1 and status = 'ready' and updated_at = $2 returning updated_at`, [quiz.id, updatedAt]));
const cur = (await db.query('select updated_at from public.transcription_artifacts where id = $1', [quiz.id])).rows[0].updated_at;
ok((await append(b, cur)).rows.length === 0, "follow-ups can't be written into another user's quiz");
const done = await append(a, cur);
ok(done.rows.length === 1, 'the server (as the user) adds follow-ups to their quiz');
ok((await append(a, cur)).rows.length === 0, 'a second write based on the old version is refused (no lost updates; the server re-reads and retries once)');
const row = (await db.query('select content, progress from public.transcription_artifacts where id = $1', [quiz.id])).rows[0];
ok(row.content.questions.length === 1 && row.content.followups.length === 1 && row.progress.review.c.c1.s === 'review', "the quiz's own questions and the learner's progress are untouched");
// deleting the recording removes its quizzes (and so their review state)
await P.asUser(a, (d) => d.query('delete from public.transcriptions where id = $1', [a2.id]));
ok((await byIds(a, [a1.id, a2.id])).rows.length === 1, 'a deleted recording is gone from every later request (the page flags saved answers that cite it)');

// ---- the one-at-a-time guard reads the user's own ledger rows only ----
await P.asUser(a, (d) => d.query(`select public.ai_reserve('across:ask', 1000, null)`));
const mine = (uid) => P.asUser(uid, (d) => d.query(`select count(*)::int n from public.ai_usage where status = 'reserved' and feature like 'across:%'`));
ok((await mine(a)).rows[0].n === 1, 'a running cross-recording request is visible to its user');
ok((await mine(b)).rows[0].n === 0, "…and not to anyone else (one user's requests never block another's)");
let forged = null; try { await P.asUser(a, (d) => d.query(`insert into public.ai_usage (feature) values ('across:ask')`)); } catch (e) { forged = e; }
ok(forged, "the ledger can't be written directly (only through ai_reserve)");
console.log(`\n${pass} checks passed`);
