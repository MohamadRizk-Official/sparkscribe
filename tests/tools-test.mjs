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

// flashcards (study engine 2): knowledge map first; weak cards dropped, each with its reason
const fc = await svc.generateArtifact(db, { transcriptionId: T, kind: 'flashcards' });
const fq = fc.artifact.content.quality;
ok(fc.artifact.settingsKey === 'g2' && fc.artifact.content.engine === 2, 'new flashcards are stored under their own key (earlier ones are never overwritten)');
ok(fc.artifact.content.cards.length === 2, 'only the two sound cards are kept');
ok(fq.circular === 1 && fq.vague === 1 && fq.duplicate === 1 && fq.minor_concept === 1 && fq.unreliable_source === 1 && fq.no_concept === 1 && fq.attribution_lost === 1,
  'circular, vague, duplicate, trivia, unreliable-passage, ungrounded and attribution-less cards are each dropped and counted');
ok(fq.explanation_removed === 1 && fc.artifact.content.cards.some((k) => k.explanation) && fc.artifact.content.cards.some((k) => k.explanation === null), 'an explanation that only repeats the answer is removed; useful ones stay');
ok(fc.artifact.content.cards.every((k) => k.refs.length), "a card without lines gets its concept's lines");
ok(fc.artifact.content.target === tools.cardCount(25, 'standard'), 'card count is a ceiling that follows recording length');
const fcMore = await svc.generateArtifact(db, { transcriptionId: T, kind: 'flashcards', settings: { size: 'more' } });
ok(!fcMore.cached && fcMore.artifact.settingsKey === 'g2;size=more', '"More" is its own cached result');
ok((await svc.generateArtifact(db, { transcriptionId: T, kind: 'flashcards', settings: { size: 'bogus' } })).cached === true, 'unknown setting falls back to standard (cached)');
const fcEss = await svc.generateArtifact(db, { transcriptionId: T, kind: 'flashcards', settings: { focus: 'essentials' } });
ok(fcEss.artifact.content.target < tools.cardCount(25, 'standard'), 'Essentials asks for fewer cards');

// quiz (study engine 2): trivia true/false, giveaway options, "all of the above" and malformed questions dropped
const qz = await svc.generateArtifact(db, { transcriptionId: T, kind: 'quiz' });
const qs = qz.artifact.content.questions, qq = qz.artifact.content.quality;
ok(qq.trivial_true_false === 1 && qq.giveaway_length === 1 && qq.all_none_option === 1 && qq.malformed === 1 && qq.minor_concept === 1, 'weak questions dropped, each with its reason');
ok(qs.length === 3 && qs.filter((q) => q.type === 'true_false').length === 1 && qs.find((q) => q.type === 'true_false').skill === 'misconception', 'true/false kept only for a misconception');
ok(qs.find((q) => q.type === 'true_false').answer === 'False', 'true/false answer normalised');
const mc = qs.find((q) => q.type === 'multiple_choice');
ok(mc.options.filter((o) => o === mc.answer).length === 1 && mc.options.length === 4, 'multiple choice keeps exactly one correct option');
ok(qs.every((q) => q.refs.length && q.evidence), "every question points at its lines and keeps the concept's evidence (used when grading short answers)");

// coverage pass: a core concept the first pass left untested gets an item from a second, small call
process.env.AI_MOCK_UNCOVERED = '1';
const T3 = '55555555-5555-4555-8555-555555555555';
db.seed({ id: T3, title: 'Coverage', duration_seconds: 1500, transcript_text: 'x', segments: seg, recording_type: 'lecture' });
const cov = await svc.generateArtifact(db, { transcriptionId: T3, kind: 'flashcards' });
const covQ = await svc.generateArtifact(db, { transcriptionId: T3, kind: 'quiz' });
process.env.AI_MOCK_UNCOVERED = '';
ok(cov.artifact.content.cards.some((k) => k.concept === 'c1') && cov.artifact.content.quality.filled >= 1 && cov.artifact.content.quality.core_uncovered === 0, 'flashcards: an untested core concept is filled in by the coverage pass');
ok(covQ.artifact.content.questions.some((q) => q.concept === 'c1') && covQ.artifact.content.quality.core_uncovered === 0, 'quiz: the same for questions');
ok(cov.artifact.content.cards.length === fc.artifact.content.cards.length, 'items added by the coverage pass go through the same checks (same result as a complete first pass)');

// exam points: explicit claim without exam words is downgraded
const ep = await svc.generateArtifact(db, { transcriptionId: T, kind: 'exam_points' });
ok(ep.artifact.content.explicit.length === 0 && ep.artifact.content.worth_reviewing.length === 1, 'unsupported "explicit exam" item downgraded');

// meeting recap: participants from speaker labels, invalid topic start repaired to null
const mr = await svc.generateArtifact(db, { transcriptionId: T, kind: 'meeting_recap' });
ok(mr.artifact.content.participants.map((p) => p.label).join() === '{{S1}},{{S2}}' && mr.artifact.content.speakers.S2.name === 'Speaker 2', "participants come from the transcript's speakers, as codes that show current names");
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

// a plain rename: the version moves on, but results stay current (no new generation, no cost)
db.seed({ id: T, segments: seg.map((x, i) => (i === 3 ? { ...x, sp: 'Hadi', o: 'Speaker 2' } : x)) });
const st = await svc.getState(db, T);
ok(st.contentVersion === 2 && st.artifacts.find((a) => a.kind === 'study_guide').sourceVersion === 1, 'the rename gives the transcript a new version');
ok((await svc.generateArtifact(db, { transcriptionId: T, kind: 'study_guide' })).cached === true, 'a rename alone does not regenerate (same words, same who-said-what)');
// changed words: out of date, regenerated
db.seed({ id: T, segments: seg.map((x, i) => (i === 3 ? { ...x, sp: 'Hadi', o: 'Speaker 2', t: 'Can you send me the slides tomorrow?' } : x)) });
const sg2 = await svc.generateArtifact(db, { transcriptionId: T, kind: 'study_guide' });
ok(!sg2.cached && sg2.artifact.sourceVersion === 3, 'changed words: the study guide is regenerated for the new version');

// failure keeps the previous content and version
process.env.AI_MOCK_FAIL = '1';
await assert.rejects(svc.generateArtifact(db, { transcriptionId: T, kind: 'quiz', force: true }));
process.env.AI_MOCK_FAIL = '';
const afterFail = (await svc.getState(db, T)).artifacts.find((a) => a.kind === 'quiz' && a.settingsKey === 'g2');
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
ok(mcOnly.artifact.settingsKey === 'g2;diff=harder;types=multiple_choice' && mcOnly.artifact.content.questions.every((q) => q.type === 'multiple_choice'), '"multiple choice only" quiz keeps only multiple choice');
// lecture insights (Notes): exam points need exam wording
const ins = await svc.generate(db, { transcriptionId: T, kind: 'insights', recordingType: 'lecture' });
ok(Array.isArray(ins.insight.content.exam_points), 'lecture notes: exam points present (validated)');

// details check unit
ok(tools.unverifiedDetails('See you Friday at 3pm, budget $500', 'we meet friday').join() === '3pm,$500', 'unverifiedDetails flags only what the recording lacks');
ok(tools.EXAM_RE.test('this will be on the midterm') && !tools.EXAM_RE.test('this is really important'), 'exam wording detector');

console.log(`\n${pass} checks passed`);
