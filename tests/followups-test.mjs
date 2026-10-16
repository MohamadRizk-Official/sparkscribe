// Focused Review follow-up questions (server/ai/service.js generateFollowups) with the in-memory store and the mock
// provider: written only for concepts of the learner's own quiz, checked like quiz questions, never repeating a
// question already seen, added without moving any existing question, and refused when the quiz is out of date.
import assert from 'node:assert/strict';
import { memoryStore } from './memory-store.mjs';
process.env.AI_PROVIDER = 'mock';
const root = new URL('../', import.meta.url).href;
const svc = await import(root + 'server/ai/service.js');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const rejects = async (p, code) => { try { await p; return false; } catch (e) { return e.code === code; } };
const quiet = console.log; console.log = (...a) => { if (!String(a[0]).startsWith('[ai-usage]')) quiet(...a); };

const lines = [
  ['Speaker 1', 'Today we cover the cell membrane, which is a phospholipid bilayer.'],
  ['Speaker 1', 'A phospholipid has a head that likes water and tails that avoid water.'],
  ['Speaker 1', 'The bilayer forms because the tails hide from water inside the membrane.'],
  ['Speaker 1', 'Proteins in the membrane let some molecules through and keep others out.'],
];
const seg = lines.map(([sp, t], i) => ({ s: i * 30, e: i * 30 + 25, sp, t }));
const U = '11111111-1111-4111-8111-111111111111';
const db = memoryStore({ userId: U });
const T = '22222222-2222-4222-8222-222222222222';
db.seed({ id: T, user_id: U, title: 'Cell membrane', duration_seconds: 1500, transcript_text: 'x', segments: seg, recording_type: 'lecture' });

const quiz = (await svc.generateArtifact(db, { transcriptionId: T, kind: 'quiz' })).artifact;
ok(quiz.content.map?.concepts?.length && quiz.content.questions.every((q) => q.concept), 'the quiz (study engine 3) stores its map and each question names its concept');
const own = quiz.content.questions[0].concept;
const before = JSON.stringify(quiz.content.questions);
await db._a.find((a) => a.id === quiz.id) && Object.assign(db._a.find((a) => a.id === quiz.id), { progress: { last_score: 1, total: 3, review: { v: 1, c: { [own]: { s: 'review', m: 1, ok: 0, q: [0], t: 1 } }, flag: [] } } });

// the plan: Bolt and Thunder only, checked before the quiz is read or any AI call is reserved
for (const plan of ['free', 'flash']) {
  db.plan = plan;
  const n = db._ai.length;
  let e = null; try { await svc.generateFollowups(db, { transcriptionId: T, artifactId: quiz.id, conceptIds: [own], userId: U }); } catch (x) { e = x; }
  ok(e?.code === 'plan_required' && e.status === 403 && e.details.plan === 'bolt' && /Bolt and Thunder/.test(e.message) && db._ai.length === n && !(db._a.find((a) => a.id === quiz.id).content.followups || []).length,
    `${plan}: new practice questions are refused (included with Bolt and Thunder); no AI call, the quiz untouched`);
}
db.plan = 'thunder';
db.entitlementsError = 'down';
ok(await rejects(svc.generateFollowups(db, { transcriptionId: T, artifactId: quiz.id, conceptIds: [own], userId: U }), 'plan_unavailable'), 'the plan cannot be read → refused, not treated as entitled');
db.entitlementsError = null;
db.plan = 'bolt';
const r = await svc.generateFollowups(db, { transcriptionId: T, artifactId: quiz.id, conceptIds: [own, own, 'zzz'], userId: U });
const f = r.artifact.content.followups || [];
ok(r.added >= 1 && f.length === r.added && f.every((q) => q.followup && q.concept === own), 'new questions are written for the asked concept only (unknown ids ignored)');
ok(JSON.stringify(r.artifact.content.questions) === before, "the quiz's own questions (and so every saved index) are unchanged");
ok(r.artifact.progress?.review?.c?.[own]?.s === 'review' && r.artifact.progress.last_score === 1, "the learner's progress and review state are untouched");
ok(!f.some((q) => quiz.content.questions.some((x) => x.question === q.question)), 'a question the learner already saw is never repeated (the mock returns one exact repeat: dropped)');
ok(f.every((q) => q.type !== 'multiple_choice' || (q.options.length >= 3 && q.options.includes(q.answer))), 'follow-ups pass the same quiz checks (well-formed options, one keyed answer)');

// a follow-up short answer can be graded like any quiz question (same index as the browser uses)
const sa = { concept: own, type: 'short_answer', question: 'What forms the membrane?', answer: 'phospholipid bilayer', accept: [], refs: [0], followup: true };
const cur = db._a.find((a) => a.id === quiz.id);
Object.assign(cur, { content: { ...cur.content, followups: [...cur.content.followups, sa] } });
const idx = cur.content.questions.length + cur.content.followups.length - 1;
ok(['correct', 'close'].includes((await svc.gradeShortAnswer(db, { transcriptionId: T, artifactId: quiz.id, index: idx, answer: 'a phospholipid bilayer' })).verdict), 'a follow-up short answer is graded from the stored quiz');

// refusals
ok(await rejects(svc.generateFollowups(db, { transcriptionId: T, artifactId: quiz.id, conceptIds: [], userId: U }), 'bad_request'), 'nothing to practise → refused before any AI call');
ok(await rejects(svc.generateFollowups(db, { transcriptionId: T, artifactId: '99999999-9999-4999-8999-999999999999', conceptIds: [own], userId: U }), 'not_found'), 'a quiz that is not this user’s (or not a quiz) → not found');
const OTHER = '33333333-3333-4333-8333-333333333333';
db.seed({ id: OTHER, user_id: '44444444-4444-4444-8444-444444444444', title: 'Someone else', duration_seconds: 60, transcript_text: 'x', segments: seg, recording_type: 'lecture' });
ok(await rejects(svc.generateFollowups(db, { transcriptionId: OTHER, artifactId: quiz.id, conceptIds: [own], userId: U }), 'not_found'), "another user's recording → not found (the store answers as the signed-in user)");
const spent = db._ai.length;
cur.content.followups = Array.from({ length: svc.MAX_FOLLOWUPS }, () => sa);
ok(await rejects(svc.generateFollowups(db, { transcriptionId: T, artifactId: quiz.id, conceptIds: [own], userId: U }), 'limit') && db._ai.length === spent, 'at most 30 follow-ups per quiz; past that, refused with no AI call');
cur.content.followups = [];
db.seed({ id: T, user_id: U, title: 'Cell membrane', duration_seconds: 1500, transcript_text: 'x', segments: seg.map((s, i) => (i === 1 ? { ...s, t: 'The membrane was explained differently now.' } : s)), recording_type: 'lecture' });
ok(await rejects(svc.generateFollowups(db, { transcriptionId: T, artifactId: quiz.id, conceptIds: [own], userId: U }), 'stale'), 'transcript words changed since the quiz → refused (update the quiz first)');
// metering
ok(db._ai.some((x) => x.feature === 'tool:quiz:followup' && x.status === 'done'), 'follow-ups are reserved and settled in the AI usage ledger like every AI action');
console.log = quiet;
console.log(`\n${pass} checks passed`);
