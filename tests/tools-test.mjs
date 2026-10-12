// Phase 5 tool pipeline with the in-memory store + mock provider (no network, no key, no cost).
import assert from 'node:assert/strict';
import { memoryStore } from './memory-store.mjs';
process.env.AI_PROVIDER = 'mock';
const root = new URL('../', import.meta.url).href;
const svc = await import(root + 'server/ai/service.js');
const tools = await import(root + 'server/ai/tools.js');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

const lines = [
  ['Speaker 1', 'Today we cover the cell membrane, which is a phospholipid bilayer.'],
  ['Speaker 1', 'A phospholipid has a head that likes water and tails that avoid water.'],
  ['Speaker 1', 'This bilayer will definitely be on the midterm, so know how to draw it.'],
  ['Speaker 2', 'Can you send me the file sometime tomorrow? No rush.'],
];
const seg = lines.map(([sp, t], i) => ({ s: i * 30, e: i * 30 + 25, sp, t }));
const db = memoryStore();
const T = '22222222-2222-4222-8222-222222222222';
db.seed({ id: T, title: 'Cell membrane', duration_seconds: 1500, transcript_text: 'x', segments: seg, recording_type: 'lecture' });

// study guide
const sg = await svc.generateArtifact(db, { transcriptionId: T, kind: 'study_guide' });
const c = sg.artifact.content;
ok(sg.artifact.status === 'ready' && !sg.cached, 'study guide generated');
ok(!c.definitions.some((d) => d.term === 'Invented'), 'definition with invented evidence dropped');
ok(c.exam_info.length === 0 && c.review.some((r) => /Not really an exam/.test(r.text)), 'exam claim without exam words moved to "worth reviewing"');
ok(c.processes.length === 0, 'one-step "process" dropped');
ok((await svc.generateArtifact(db, { transcriptionId: T, kind: 'study_guide' })).cached === true, 'second request served from storage');

// flashcards: duplicates, vague and invented cards dropped; settings make separate cache entries
const fc = await svc.generateArtifact(db, { transcriptionId: T, kind: 'flashcards' });
ok(fc.artifact.content.cards.length === 1, 'duplicate, vague and ungrounded flashcards dropped');
ok(fc.artifact.content.target === tools.cardCount(25, 'standard'), 'card target follows recording length');
const fcMore = await svc.generateArtifact(db, { transcriptionId: T, kind: 'flashcards', settings: { size: 'more' } });
ok(!fcMore.cached && fcMore.artifact.settingsKey === 'size=more', '"More" is its own cached result');
ok((await svc.generateArtifact(db, { transcriptionId: T, kind: 'flashcards', settings: { size: 'bogus' } })).cached === true, 'unknown setting falls back to standard (cached)');

// quiz: malformed question dropped; true/false normalised; options shuffled but answer kept
const qz = await svc.generateArtifact(db, { transcriptionId: T, kind: 'quiz' });
const qs = qz.artifact.content.questions;
ok(qs.length === 3 && !qs.some((q) => /Malformed/.test(q.question)), 'malformed multiple-choice question dropped');
ok(qs.find((q) => q.type === 'true_false').answer === 'True', 'true/false answer normalised');
const mc = qs.find((q) => q.type === 'multiple_choice');
ok(mc.options.filter((o) => o === mc.answer).length === 1 && mc.options.length === 4, 'multiple choice keeps exactly one correct option');

// exam points: explicit claim without exam words is downgraded
const ep = await svc.generateArtifact(db, { transcriptionId: T, kind: 'exam_points' });
ok(ep.artifact.content.explicit.length === 0 && ep.artifact.content.worth_reviewing.length === 1, 'unsupported "explicit exam" item downgraded');

// meeting recap: participants from speaker labels, invalid topic start repaired to null
const mr = await svc.generateArtifact(db, { transcriptionId: T, kind: 'meeting_recap' });
ok(mr.artifact.content.participants.map((p) => p.label).join() === 'Speaker 1,Speaker 2', 'participants come from transcript labels');
ok(mr.artifact.content.topics[0].start_ref === null, 'invalid topic start not trusted');

// drafts: details not in the recording are flagged
const em = await svc.generateArtifact(db, { transcriptionId: T, kind: 'followup_email', settings: { instructions: 'Recap what we covered.' } });
ok(em.artifact.content.unverified.includes('$49') && em.artifact.content.unverified.some((d) => /monday/i.test(d)), 'email: unsupported price and day flagged');
const rd = await svc.generateArtifact(db, { transcriptionId: T, kind: 'reply_draft', settings: { instructions: 'Reply to what was asked.' } });
ok(rd.artifact.content.unverified.some((d) => /first thing/i.test(d)), 'reply: "first thing" (stronger than said) flagged');
ok(!rd.artifact.content.unverified.some((d) => /tomorrow/i.test(d)), 'reply: "tomorrow" (said in the recording) not flagged');

// interview quotes: made-up quote dropped
const iq = await svc.generateArtifact(db, { transcriptionId: T, kind: 'interview_qa' });
ok(iq.artifact.content.quotes.length === 1, 'interview: non-verbatim quote dropped');

// stale + update
db.seed({ id: T, segments: seg.map((x, i) => (i === 3 ? { ...x, sp: 'Hadi' } : x)) });
const st = await svc.getState(db, T);
ok(st.contentVersion === 2 && st.artifacts.find((a) => a.kind === 'study_guide').sourceVersion === 1, 'state shows artifacts made from version 1 (out of date)');
const sg2 = await svc.generateArtifact(db, { transcriptionId: T, kind: 'study_guide' });
ok(!sg2.cached && sg2.artifact.sourceVersion === 2, 'out-of-date study guide regenerated for the new version');

// failure keeps the previous content and version
process.env.AI_MOCK_FAIL = '1';
await assert.rejects(svc.generateArtifact(db, { transcriptionId: T, kind: 'quiz', force: true }));
process.env.AI_MOCK_FAIL = '';
const afterFail = (await svc.getState(db, T)).artifacts.find((a) => a.kind === 'quiz' && !a.settingsKey);
ok(afterFail.status === 'failed' && afterFail.content?.questions?.length === 3 && afterFail.sourceVersion === 1, 'failed update keeps previous quiz and its version');
pass++;

// unknown kind rejected
await assert.rejects(svc.generateArtifact(db, { transcriptionId: T, kind: 'nonsense' }));
pass++;

// Phase 5.5: settings and user instructions
const T2 = '33333333-3333-4333-8333-333333333333';
db.seed({ id: T2, title: 'Voice', duration_seconds: 20, transcript_text: 'x', segments: seg.slice(3), recording_type: 'voice_message' });
// Phase 5.6: a draft needs the user's request; old preset intents are ignored
await assert.rejects(svc.generateArtifact(db, { transcriptionId: T2, kind: 'reply_draft', settings: { intent: 'confirm' } }), /what you want the reply to be about/, 'reply without a request rejected');
await assert.rejects(svc.generateArtifact(db, { transcriptionId: T2, kind: 'followup_email', settings: { instructions: '   ' } }), /what you want the email to be about/, 'email with a blank request rejected');
pass += 2; console.log('ok - drafts without a request are rejected (reply, email)');
ok(!(await db.getArtifact(T2, 'reply_draft', '')) && !(await db.getArtifact(T2, 'followup_email', '')), 'no artifact row created for a rejected draft');
const told = await svc.generateArtifact(db, { transcriptionId: T2, kind: 'reply_draft', settings: { intent: 'confirm', instructions: 'Say I will send it first thing tomorrow.' } });
ok(/^i=[0-9a-f]{8}$/.test(told.artifact.settingsKey) && !told.artifact.content.unverified.some((d) => /first thing/i.test(d)), 'reply with a request: key from the request only; what the user asked for is not flagged');
ok(!told.cached && (await svc.generateArtifact(db, { transcriptionId: T2, kind: 'reply_draft', settings: { instructions: 'Say I will send it first thing tomorrow.' } })).cached, 'same request served from storage');
const other = await svc.generateArtifact(db, { transcriptionId: T2, kind: 'reply_draft', settings: { instructions: 'Ask him about the timeline.' } });
ok(!other.cached && other.artifact.content.unverified.some((d) => /first thing/i.test(d)), 'a commitment the user did not ask for is flagged');
const mcOnly = await svc.generateArtifact(db, { transcriptionId: T, kind: 'quiz', settings: { types: 'multiple_choice', difficulty: 'harder' } });
ok(mcOnly.artifact.settingsKey === 'diff=harder;types=multiple_choice' && mcOnly.artifact.content.questions.every((q) => q.type === 'multiple_choice'), '"multiple choice only" quiz keeps only multiple choice');
// lecture insights (Notes): exam points need exam wording
const ins = await svc.generate(db, { transcriptionId: T, kind: 'insights', recordingType: 'lecture' });
ok(Array.isArray(ins.insight.content.exam_points), 'lecture notes: exam points present (validated)');

// details check unit
ok(tools.unverifiedDetails('See you Friday at 3pm, budget $500', 'we meet friday').join() === '3pm,$500', 'unverifiedDetails flags only what the recording lacks');
ok(tools.EXAM_RE.test('this will be on the midterm') && !tools.EXAM_RE.test('this is really important'), 'exam wording detector');

console.log(`\n${pass} checks passed`);
