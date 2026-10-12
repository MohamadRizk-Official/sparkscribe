// Server pipeline tests with the in-memory store + mock provider (no network, no key).
import assert from 'node:assert/strict';
import { memoryStore } from './memory-store.mjs';
process.env.AI_PROVIDER = 'mock';
const root = new URL('../', import.meta.url).href;
const svc = await import(root + 'server/ai/service.js');
const { selectContext, needsRetrieval } = await import(root + 'server/ai/retrieve.js');
const { groundAnswer, groundStructured, groundChapters } = await import(root + 'server/ai/grounding.js');
const { segmentsFromRow, isNegativeAnswer, refersToPlayback, isFollowUp } = await import(root + 'src/lib/segments.js');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

// --- a meeting transcript with explicit actions, a decision, a deadline ---
const lines = [
  ['Speaker 1', 'Okay, let us start. Today we need to settle the subscription price and the launch date.'],
  ['Speaker 2', 'I think we could charge nine ninety nine, but that might be too high for students.'],
  ['Speaker 1', 'After the survey results, we agreed the price will be seven ninety nine per month.'],
  ['Speaker 2', 'Great. Hadi, can you send the revised proposal by Friday?'],
  ['Speaker 3', 'Yes, I will send the revised proposal by Friday.'],
  ['Speaker 1', 'The launch is planned for next Monday, after the database migration.'],
  ['Speaker 2', 'Supabase handles the user accounts and row level security.'],
  ['Speaker 3', 'What about the accuracy testing, who owns that?'],
  ['Speaker 1', 'We still need to decide who owns accuracy testing.'],
  ['Speaker 2', 'Transcription reliability remains the priority for this release.'],
];
const seg = lines.map(([sp, t], i) => ({ s: i * 50, e: i * 50 + 45, sp, t }));
const db = memoryStore();
const T = '11111111-2222-4333-8444-555555555555';
db.seed({ id: T, title: 'Pricing meeting', duration_seconds: 520, transcript_text: 'x', segments: seg });

// overview: generated once, grounded, then cached
const a = await svc.generate(db, { transcriptionId: T, kind: 'overview' });
ok(a.insight.status === 'ready' && !a.cached, 'overview generated');
ok(a.insight.content.key_points.every((p) => p.refs.every((r) => r >= 0 && r < seg.length)), 'key point refs are real lines');
ok(!a.insight.content.key_points.some((p) => p.refs.includes(99999)), 'invented line reference removed');
ok(a.insight.content.chapters.length >= 2 && a.insight.content.chapters[0].start_ref === 0, 'chapters start at first line (>= 8 min recording)');
const b = await svc.generate(db, { transcriptionId: T, kind: 'overview' });
ok(b.cached === true, 'second request served from storage (no model call)');

// insights (meeting): invented items and invented quotes dropped
const m = await svc.generate(db, { transcriptionId: T, kind: 'insights', recordingType: 'meeting' });
ok(m.insight.content.decisions.some((d) => /agreed/.test(d.text)), 'decision found');
ok(!m.insight.content.action_items.some((x) => x.task.includes('Invented')), 'ungrounded action item dropped');
ok(m.insight.content.action_items.some((x) => x.deadline && /Friday/.test(x.deadline)), 'deadline kept as said');
const iv = await svc.generate(db, { transcriptionId: T, kind: 'insights', recordingType: 'interview' });
ok(iv.insight.content.notable_quotes.length >= 1 && !iv.insight.content.notable_quotes.some((q) => /nobody ever said/.test(q.quote)), 'fabricated quote dropped, real quotes kept');
ok(!m.insight.content.decisions.some((d) => /Invented/.test(d.text)), 'decision whose evidence is not in the transcript dropped');
ok(m.insight.content.decisions.every((d) => d.evidence), 'kept decisions carry their evidence');
const lec = await svc.generate(db, { transcriptionId: T, kind: 'insights', recordingType: 'lecture' });
ok(!('notes' in lec.insight.content), 'lecture insights no longer contain notes (Notes is its own tab)');

// notes: own kind, cached per type, grounded, section starts repaired
const n1 = await svc.generate(db, { transcriptionId: T, kind: 'notes', recordingType: 'meeting' });
const ns = n1.insight.content.sections;
ok(n1.insight.status === 'ready' && n1.insight.kind === 'notes' && n1.insight.recordingType === 'meeting' && ns.length >= 1, 'notes generated as their own kind');
ok(ns.every((s) => Number.isInteger(s.start_ref) && s.start_ref >= 0 && s.start_ref < seg.length), 'invalid section start replaced by a real line');
ok(!ns.some((s) => s.items.some((i) => /Ungrounded/.test(i.text))), 'ungrounded note dropped');
ok((await svc.generate(db, { transcriptionId: T, kind: 'notes', recordingType: 'meeting' })).cached === true, 'notes served from storage on reopen');
const n2 = await svc.generate(db, { transcriptionId: T, kind: 'notes', recordingType: 'lecture' });
ok(!n2.cached && n2.insight.recordingType === 'lecture', 'notes for another recording type generated separately');
await assert.rejects(svc.generate(db, { transcriptionId: T, kind: 'bogus' }), 'unknown kind rejected');
pass++;

// staleness: editing the transcript bumps the version; stored result is then regenerated, not reused
db.seed({ id: T, segments: seg.map((x) => (x.sp === 'Speaker 3' ? { ...x, sp: 'Hadi' } : x)) });
const st = await svc.getState(db, T);
ok(st.contentVersion === 2 && st.insights.find((i) => i.kind === 'overview').sourceVersion === 1, 'state reports outdated result (version 1 < 2)');
const c = await svc.generate(db, { transcriptionId: T, kind: 'overview' });
ok(!c.cached && c.insight.sourceVersion === 2, 'outdated overview regenerated for new version');

// ask: grounded, citations filtered, not-found, cached repeat
const ev = [];
const q1 = await svc.askTranscript(db, { transcriptionId: T, question: 'What subscription price per month did they agree on?' }, (e) => ev.push(e));
ok(q1.found && q1.refs.length && q1.refs.every((r) => r < seg.length), 'answer cites only real lines');
ok(!q1.answer.includes('99999'), 'citation of a line that was not provided is removed');
ok(ev.some((e) => e.type === 'delta'), 'answer streamed');
const q2 = await svc.askTranscript(db, { transcriptionId: T, question: 'What did the professor say about the final exam chapters?' }, () => {});
ok(!q2.found && !q2.unsupported && /doesn't mention/.test(q2.answer) && !/couldn.t find/.test(q2.answer) && q2.refs.length === 0, 'unsupported question -> specific "not mentioned" answer, not flagged');
const q3 = await svc.askTranscript(db, { transcriptionId: T, question: 'what subscription price per month did they agree on' }, () => {});
ok(q3.cached === true, 'repeated question answered from storage');
ok((await svc.askTranscript(db, { transcriptionId: T, question: 'What did the professor say about the final exam chapters?' }, () => {})).cached, 'a specific "not mentioned" answer is reused too');
// follow-ups depend on the previous turn: never answered from storage
const f1 = await svc.askTranscript(db, { transcriptionId: T, question: 'Why?' }, () => {});
const f2 = await svc.askTranscript(db, { transcriptionId: T, question: 'Why?' }, () => {});
ok(!f1.cached && !f2.cached, 'short follow-up ("Why?") is not served from storage');
// the generic sentence older versions stored is asked again, not reused
await db.saveQuestion({ transcriptionId: T, question: 'Which dentist does he use?', answer: "I couldn't find that in this recording.", refs: [], found: false, version: 2, model: 'old', usage: { input: 0, output: 0 } });
ok(!(await svc.askTranscript(db, { transcriptionId: T, question: 'Which dentist does he use?' }, () => {})).cached, 'old generic "not found" answer is not reused');
// a real answer saved under the old Ask rules stays in history but is not reused for a repeated question
await db.saveQuestion({ transcriptionId: T, question: 'What does this person need from me?', answer: "The excerpts don't contain any request directed at you [1].", refs: [1], found: true, version: 2, model: 'old', usage: { input: 0, output: 0 } });
(await db.listQuestions(T)).at(-1).created_at = '2026-10-08T18:30:20Z';
const re = await svc.askTranscript(db, { transcriptionId: T, question: 'What does this person need from me?' }, () => {});
ok(!re.cached && (await db.listQuestions(T)).some((q) => q.created_at === '2026-10-08T18:30:20Z'), 'answer from before the new Ask rules is kept in history but asked again');
ok((await svc.askTranscript(db, { transcriptionId: T, question: 'What does this person need from me?' }, () => {})).cached, 'the new answer is then reused');

// grounding unit checks
const segs = segmentsFromRow({ segments: seg }).segments;
const g = groundAnswer('The price is $7.99 [2][57]. Hadi sends it Friday [3, 4].', [0, 1, 2, 3, 4]);
ok(g.answer === 'The price is $7.99 [2]. Hadi sends it Friday [3, 4].' && g.refs.join() === '2,3,4', 'groundAnswer filters invalid ids and keeps valid ones');
ok(groundAnswer('Something with no citation.', [1]).unsupported === true, 'answer without citations flagged unsupported');
const neg = groundAnswer('No specific dates, deadlines or times were mentioned.', [1]);
ok(!neg.found && !neg.unsupported, 'uncited "nothing was mentioned" answer is a valid negative, not flagged');
ok(groundAnswer("No deadline was mentioned. Since it's a big project, the timeline is worth confirming [1].", [1]).found, 'negative + cited practical note counts as found');
ok(isNegativeAnswer("He doesn't mention a budget.") && isNegativeAnswer("The recording doesn't cover quantum computing.") && isNegativeAnswer("There isn't enough in the recording to tell.") && !isNegativeAnswer('He wants a website for both shops.'), 'negative-answer detector');
ok(refersToPlayback('Explain the part at 1:21 more simply') && refersToPlayback('what did he just say?') && !refersToPlayback('Does this seem urgent?') && !refersToPlayback('What does he want from me?'), 'playback-position detector ignores ordinary "this"');
ok(isFollowUp('Why?') && isFollowUp('What about shipping?') && isFollowUp('And the second store?') && !isFollowUp('What does he want from me?') && !isFollowUp('Did he mention DoorDash at all?'), 'follow-up detector');
const gs = groundStructured({ decisions: [{ text: 'x', refs: [] }, { text: 'y', refs: [2] }], key_points: [{ text: 'z', refs: [] }] }, segs);
ok(gs.content.decisions.length === 1 && gs.content.key_points.length === 0, 'items without a valid line reference are dropped (decisions and key points)');
ok(!a.insight.content.key_points.some((p) => /Ungrounded/.test(p.text)), 'ungrounded key point not shown');
const ge = groundStructured({
  decisions: [{ text: 'Price is 7.99', evidence: 'we agreed the price will be seven ninety nine', refs: [2] }, { text: 'Price is 9.99', evidence: 'we agreed on nine ninety nine', refs: [1] }],
  action_items: [{ task: 'Send proposal', owner: 'Speaker 3', deadline: 'Friday', evidence: 'I will send the revised proposal by Friday', refs: [4] }, { task: 'Own testing', owner: null, deadline: null, evidence: 'Speaker 3 will own testing', refs: [8] }],
}, segs);
ok(ge.content.decisions.length === 1 && ge.content.decisions[0].refs[0] === 2, 'decision evidence must be verbatim in the cited lines');
ok(ge.content.action_items.length === 1 && ge.content.action_items[0].task === 'Send proposal' && ge.dropped === 2, 'action item with invented evidence dropped');
const ch = groundChapters([{ title: 'B', start_ref: 6, summary: '' }, { title: 'A', start_ref: 3, summary: '' }, { title: 'dup', start_ref: 3, summary: '' }, { title: 'bad', start_ref: 500, summary: '' }], segs);
ok(ch.map((c) => c.title).join() === 'A,B' && ch[0].start_ref === 0, 'chapters sorted, deduped, invalid dropped, first at start');

// retrieval on a long transcript: only relevant excerpts, includes the right line
const long = [];
for (let i = 0; i < 900; i++) long.push({ s: i * 8, e: i * 8 + 7, sp: i % 2 ? 'Speaker 2' : 'Speaker 1', t: `Filler discussion number ${i} about general project status and various unrelated things we talked about.` });
long[612] = { ...long[612], t: 'The final exam covers chapters six through nine, and the essay is due on the twentieth.' };
const ls = segmentsFromRow({ segments: long }).segments;
ok(needsRetrieval(ls), 'long transcript uses retrieval');
const ctx = selectContext(ls, { question: 'Which chapters are on the final exam?' });
ok(ctx.mode === 'retrieval' && ctx.ids.includes(612) && ctx.ids.length < ls.length / 4, `retrieval picks the exam line within budget (${ctx.ids.length}/${ls.length} lines)`);
const ctx2 = selectContext(ls, { question: 'explain this part more simply', at: 300 * 8 + 2 });
ok(ctx2.ids.includes(300), 'deictic question includes the lines at the playback position');
const ctx3 = selectContext(ls, { question: 'What did Speaker 2 say about the exam?' });
ok(ctx3.ids.includes(612), 'speaker-scoped question still finds the line');

// old transcript without segments falls back to paragraphs
const old = segmentsFromRow({ transcript_text: 'f.m4a\nLength: 1:00 · Speakers: A\n\n[0:00] Speaker 1:\nHello there.\n\n[0:31] Speaker 2:\nHi.', duration_seconds: 60 });
ok(old.coarse && old.segments.length === 2 && old.segments[1].start === 31 && old.segments[1].end === 60, 'paragraph fallback for older saves');

console.log(`\n${pass} checks passed`);
