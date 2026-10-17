// Exam dates on courses (20261017200000_course_exams.sql), on an isolated Postgres with every migration: additive
// (existing courses kept, nothing else changes), each student can set only their own course's exam, only the exam
// columns become writable, bounds hold, and rollback + re-apply keep every course.   node qa/sql/course-exams.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDb } from './pg.mjs';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const rejects = async (p, re, m) => { let err = null; try { await p; } catch (e) { err = e; } ok(err && re.test(`${err.code} ${err.message}`), `${m} (${err ? `${err.code} ${err.message}`.slice(0, 70) : 'no error'})`); };
const MIG = '20261017200000_course_exams.sql';
const file = (p) => readFileSync(new URL(`../../supabase/${p}`, import.meta.url), 'utf8');

// the database as it is in production today: every migration except this one
const P = await freshDb({ only: (n) => n !== MIG });
const { db } = P;
const a = await P.createUser('a@example.com'), b = await P.createUser('b@example.com');
const course = async (uid, name) => P.asUser(uid, async (d) => (await d.query(`insert into public.folders (name) values ($1) returning id`, [name])).rows[0].id);
const ca = await course(a, 'Biology 201'), cb = await course(b, 'History 110');
const t = await P.asUser(a, async (d) => (await d.query(`insert into public.transcriptions (title, transcript_text, duration_seconds) values ('Lecture 1', 'x', 60) returning id`)).rows[0].id);
await P.asUser(a, (d) => d.query(`insert into public.folder_items (folder_id, transcription_id) values ($1, $2)`, [ca, t]));
const snapshot = async () => (await db.query(`select id, user_id, name, created_at from public.folders order by name`)).rows;
const before = await snapshot();
const cols = async () => (await db.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'folders' order by ordinal_position`)).rows.map((r) => r.column_name).join(',');
const colsBefore = await cols();

await db.exec(file(`migrations/${MIG}`));
ok(await cols() === `${colsBefore},exam_date,exam_topics`, 'only two columns are added');
ok(JSON.stringify(await snapshot()) === JSON.stringify(before), 'existing courses are unchanged');
ok((await db.query(`select count(*)::int n from public.folders where exam_date is not null or exam_topics is not null`)).rows[0].n === 0, 'existing courses have no exam');
ok((await db.query(`select count(*)::int n from public.folder_items`)).rows[0].n === 1, 'course memberships kept');

// the app's own queries, as the student
const set = (uid, id, date, topics) => P.asUser(uid, async (d) => (await d.query(`update public.folders set exam_date = $2, exam_topics = $3 where id = $1 returning id`, [id, date, topics])).rows.length);
ok(await set(a, ca, '2026-12-10', 'mitosis, meiosis') === 1, 'a student sets the exam on their own course');
ok(await set(a, cb, '2026-12-10', 'x') === 0, 'another student’s course: no row is visible to update (RLS)');
ok((await db.query(`select exam_date from public.folders where id = $1`, [cb])).rows[0].exam_date === null, 'the other course is untouched');
const read = await P.asUser(b, async (d) => (await d.query(`select id, exam_date, exam_topics from public.folders`)).rows);
ok(read.length === 1 && read[0].id === cb, 'students read only their own courses (and exams)');
await rejects(P.asAnon((d) => d.query(`select exam_date from public.folders`)), /42501|permission denied/, 'visitors who are not signed in can’t read exams');
await rejects(P.asUser(a, (d) => d.query(`update public.folders set user_id = $2 where id = $1`, [ca, b])), /42501|permission denied/, 'still no way to change a course’s owner');
await rejects(P.asUser(a, (d) => d.query(`update public.folders set created_at = now() where id = $1`, [ca])), /42501|permission denied/, 'other columns stay read-only');
await rejects(P.asUser(a, (d) => d.query(`insert into public.folders (name, exam_date) values ('Chem', '2026-12-01')`)), /42501|permission denied/, 'insert is still name-only (exam is set afterwards)');
await rejects(set(a, ca, '1999-01-01', null), /23514|check/, 'a date outside 2020–2100 is refused');
await rejects(set(a, ca, '2026-12-10', 'x'.repeat(1001)), /23514|check/, 'topics over 1000 characters are refused');
ok(await set(a, ca, null, null) === 1, 'removing the exam works');
await set(a, ca, '2026-12-10', 'mitosis');

// deleting a course or the account takes the exam with it
const c2 = await course(a, 'Temp');
await set(a, c2, '2026-11-20', 't');
await P.asUser(a, (d) => d.query(`delete from public.folders where id = $1`, [c2]));
ok((await db.query(`select count(*)::int n from public.folders where id = $1`, [c2])).rows[0].n === 0, 'deleting a course deletes its exam');

// recovery: rollback, then re-apply
await db.exec(file('proposed/rollback/20261017200000_course_exams.down.sql'));
ok(await cols() === colsBefore, 'rollback removes exactly the two columns');
ok(JSON.stringify(await snapshot()) === JSON.stringify(before), 'after rollback every course is still there, unchanged');
ok((await db.query(`select count(*)::int n from public.folder_items`)).rows[0].n === 1, 'memberships kept through rollback');
ok(await P.asUser(a, async (d) => (await d.query(`update public.folders set name = 'Biology 201' where id = $1 returning id`, [ca])).rows.length) === 1, 'renaming still works after rollback');
await rejects(P.asUser(a, (d) => d.query(`select exam_date from public.folders`)), /42703|does not exist/, 'after rollback the column is gone (the app detects this and hides exams)');
await db.exec(file(`migrations/${MIG}`));
ok(await set(a, ca, '2026-12-10', 'mitosis') === 1, 're-applying after a rollback works');

// the production users' data: a second account is unaffected by the first's actions
await P.asUser(b, (d) => d.query(`delete from public.folders where id = $1`, [ca]));
ok((await db.query(`select count(*)::int n from public.folders where id = $1`, [ca])).rows[0].n === 1, 'another student can’t delete the course');

const { rows: [acc] } = await db.query(`select count(*)::int n from public.folders where user_id = $1`, [a]);
await db.query(`delete from auth.users where id = $1`, [a]);
ok((await db.query(`select count(*)::int n from public.folders where user_id = $1`, [a])).rows[0].n === 0 && acc.n === 1, 'deleting the account removes its courses and exams');
console.log(`\n${pass} checks passed`);
