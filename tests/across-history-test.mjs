// Saved Thunder history (server/ai/across.js + lib/across-refs.js) with the in-memory store and the mock provider:
// what is stored (tokens, never names), how a saved answer is shown later (current titles and speaker names, edited and
// deleted recordings flagged), retried saves, failed saves, and the history list.
import assert from 'node:assert/strict';
import { memoryStore } from './memory-store.mjs';
process.env.AI_PROVIDER = 'mock';
const root = new URL('../', import.meta.url).href;
const svc = await import(root + 'server/ai/service.js');
const X = await import(root + 'server/ai/across.js');
const R = await import(root + 'src/lib/across-refs.js');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const err = async (p) => { try { await p; return null; } catch (e) { return e; } };
const quiet = console.log; console.log = (...a) => { if (!String(a[0]).startsWith('[ai-usage]')) quiet(...a); };

// ---------- tokens ----------
const opts = { labels: new Set(['R1', 'R2']), speakers: new Set(['R1.S1', 'R2.S1']), titles: new Map([['R1', 'Lecture 2'], ['R2', 'Lecture 5']]) };
const t = R.tokenizeAcross('In {R2}, [[R1.S1]] said X [R1:4]. R2 (Lecture 5, Oct 8) corrects R1. Lecture 5 (R2) again. {{R2.S1}} and R2.S1 agree; {{R1.S7}} and {{R4}} are unknown. Concept R2.c5 stays.', opts);
ok(t === 'In {{R2}}, {{R1.S1}} said X [R1:4]. {{R2}} (Oct 8) corrects {{R1}}. Lecture 5 again. {{R2.S1}} and {{R2.S1}} agree; a speaker and a recording are unknown. Concept R2.c5 stays.', `model output → stable tokens; citations and concept references untouched (${t})`);
const shown = R.renderAcross(t, { title: (l) => ({ R1: 'Bio 2', R2: 'Bio 5' })[l], speaker: (c) => ({ 'R1.S1': 'Dr. Lee', 'R2.S1': 'Speaker 1' })[c] });
ok(shown.startsWith('In Bio 5, Dr. Lee said X [R1:4]. Bio 5 (Oct 8) corrects Bio 2.') && shown.includes('Speaker 1 and Speaker 1 agree'), 'tokens → current titles and names; R1.S1 and R2.S1 resolve separately');
ok(R.renderAcrossStreaming('Hello {{R1', { title: () => 'X', speaker: () => 'Y' }) === 'Hello ', 'an unfinished token at the end of a streaming answer is hidden');
const auto = new Map([['R1', new Map([['speaker 3', 'R1.S3']])], ['R2', new Map([['speaker 1', 'R2.S1']])]]);
const ta = R.tokenizeAcross('In {{R1}}, Speaker 3 said X [R1:2]. Speaker 1 asked [R2:2]. Speaker 1 and Speaker 3 differ [R1:0, R2:1]. Speaker 3 again.', { ...opts, speakers: new Set(['R1.S3', 'R2.S1']), autoNames: auto });
ok(ta === 'In {{R1}}, {{R1.S3}} said X [R1:2]. {{R2.S1}} asked [R2:2]. Speaker 1 and Speaker 3 differ [R1:0, R2:1]. Speaker 3 again.', `"Speaker N" written out becomes a code only when its sentence is about one recording; otherwise left as written (${ta})`);
ok(R.tokenizeAcross('Speaker {{R1.S1}} agreed; the speaker {{R2.S1}} did not.', opts) === '{{R1.S1}} agreed; the speaker {{R2.S1}} did not.', '"Speaker {{R1.S1}}" loses the extra word (it would read "Speaker Speaker 1"); "the speaker …" stays');
ok(R.tokenizeAcross('{{R1.S1}} (Maya) agreed; {{R2.S1}} (the host) did not.', { ...opts, names: new Map([['R1.S1', 'Maya'], ['R2.S1', 'Sam']]) }) === '{{R1.S1}} agreed; {{R2.S1}} (the host) did not.', 'a name repeated in brackets after its own code is dropped; other brackets stay');
ok(R.renderAcross('{{R1}} (Oct 6) and {{R2}} (week 2)', { title: (l) => ({ R1: 'Team sync — Oct 6', R2: 'Lecture' })[l], speaker: () => '' }) === 'Team sync — Oct 6 and Lecture (week 2)', 'a date the title already contains is not repeated');

// ---------- a Thunder account with three recordings ----------
const U = '11111111-1111-4111-8111-111111111111';
const id = (n) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;
const seg = (lines) => lines.map(([sp, t2, o], i) => ({ s: i * 20, e: i * 20 + 18, sp, t: t2, ...(o && { o }) }));
const db = memoryStore({ userId: U });
db.plan = 'thunder';
const L1 = [['Speaker 1', 'Osmosis uses energy from ATP, like a pump.'], ['Speaker 2', 'Does osmosis need ATP every time?']];
const L2 = [['Speaker 1', 'Correction: osmosis does not need energy from ATP.'], ['Speaker 2', 'So osmosis is passive.']];
db.seed({ id: id(1), user_id: U, created_at: '2026-10-01T10:00:00Z', title: 'Lecture 2', duration_seconds: 40, transcript_text: 'x', segments: seg(L1) });
db.seed({ id: id(2), user_id: U, created_at: '2026-10-08T10:00:00Z', title: 'Lecture 5', duration_seconds: 40, transcript_text: 'x', segments: seg(L2) });
db.seed({ id: id(3), user_id: U, created_at: '2026-10-09T10:00:00Z', title: 'Lecture 6', duration_seconds: 40, transcript_text: 'x', segments: seg([['Speaker 1', 'Active transport uses ATP.']]) });

const names = [];
const req = '7d7d7d7d-0000-4000-8000-000000000001';
const r = await svc.askAcrossRecordings(db, { ids: [id(1), id(2)], question: 'Does osmosis need ATP?', userId: U, requestId: req }, (e) => { if (e.type === 'names') names.push(e.names); });
ok(r.saved && db._x.length === 1 && r.item.id === db._x[0].id, 'the answer is saved to the account as it is generated');
const stored = db._x[0];
ok(!/Lecture [25]|Speaker [12]/.test(stored.content.answer) && /\{\{R[12]\}\}/.test(stored.content.answer) && /\{\{R[12]\.S\d\}\}/.test(stored.content.answer), 'stored: tokens only — no recording title or speaker name is written into the saved answer');
ok(!stored.content.answer.includes('R9:999') && stored.content.answer.includes('a speaker'), 'stored: an invented citation is gone; an unknown speaker code became a neutral word');
ok(stored.sources.length === 2 && stored.sources.every((s) => s.version && s.basis && s.title && s.speakers), 'stored: a snapshot of each recording (label, title, version, transcript fingerprint, speaker names)');
ok(names[0]?.titles?.R1 === 'Lecture 2' && names[0].speakers['R2.S1'] === 'Speaker 1', 'while streaming, the page gets the current names to show the tokens');
ok(/In Lecture 2, Speaker \d says/.test(r.item.content.answer) && r.item.content.refs.every((x) => x.available), 'shown now: titles and speaker names resolved');

// a retried request (lost response) is saved once
await svc.askAcrossRecordings(db, { ids: [id(1), id(2)], question: 'Does osmosis need ATP?', userId: U, requestId: req });
ok(db._x.length === 1, 'the same request id saved twice → one history item');

// ---------- later: renames, edits, deletions ----------
db.seed({ id: id(1), user_id: U, created_at: '2026-10-01T10:00:00Z', title: 'Bio — osmosis intro', duration_seconds: 40, transcript_text: 'x', segments: seg([['Speaker 1', L1[0][1]], ['Ms. Kay', L1[1][1], 'Speaker 2']]) });
let th = await X.threadFor(db, [id(1), id(2)]);
let it = th.items[0];
ok(it.content.answer.includes('Bio — osmosis intro') && !it.content.answer.includes('Lecture 2'), 'recording renamed → the saved answer shows the new title, without regenerating');
ok(it.content.refs.filter((x) => x.label === 'R1').every((x) => x.title === 'Bio — osmosis intro'), '…and so do its source links');
ok(it.recordings.find((x) => x.id === id(1)).status === 'current', 'a rename alone does not mark the answer out of date');
ok(stored.content.answer.includes('In {{R1}}, {{R1.S2}} says') && stored.content.answer.includes('In {{R2}}, {{R2.S1}} says'), 'stored: who said it, as codes scoped to each recording');
ok(it.content.answer.includes('In Bio — osmosis intro, Ms. Kay says') && it.content.answer.includes('In Lecture 5, Speaker 1 says'), 'speaker renamed in one recording → the saved answer shows the new name there, and only there');
ok(R.renderAcross('{{R1.S1}} vs {{R2.S1}}', { title: () => '', speaker: (c) => X.resolveItem({ id: 'x', kind: 'ask', content: { answer: `{{${c}}}` }, sources: stored.sources }, new Map([[id(1), { title: 'a', version: 9, segments: [{ id: 0, speaker: 'Dr. Lee', orig: 'Speaker 1', text: 't' }], basis: null }], [id(2), { title: 'b', version: 9, segments: [{ id: 0, speaker: 'Speaker 1', orig: 'Speaker 1', text: 't' }], basis: null }]])).content.answer }) === 'Dr. Lee vs Speaker 1',
  '"Speaker 1" of one recording is never confused with "Speaker 1" of another');
db.seed({ id: id(2), user_id: U, created_at: '2026-10-08T10:00:00Z', title: 'Lecture 5', duration_seconds: 40, transcript_text: 'x', segments: seg([['Speaker 1', 'A different lecture about cell walls.'], ['Speaker 2', 'Noted.']]) });
it = (await X.threadFor(db, [id(1), id(2)])).items[0];
ok(it.recordings.find((x) => x.id === id(2)).status === 'edited', 'transcript words edited → the answer is flagged as possibly out of date (it is never presented as re-verified)');
db._t.delete(id(2));
th = await X.threadFor(db, [id(1)].concat([]));
ok(th.items.length === 0, 'a one-recording selection has no cross-recording history');
it = (await X.threadFor(db, [id(1), id(2)])).items[0];
ok(it.recordings.find((x) => x.id === id(2)).status === 'deleted' && it.content.refs.filter((x) => x.label === 'R2').every((x) => !x.available && x.title === 'Lecture 5'), 'recording deleted → its sources are marked unavailable (never recreated), with the title it had');
ok(it.content.answer.includes('Lecture 5'), '…and its title and speaker names come from the snapshot');

// ---------- guide, history list, deletion ----------
db.seed({ id: id(2), user_id: U, created_at: '2026-10-08T10:00:00Z', title: 'Lecture 5', duration_seconds: 40, transcript_text: 'x', segments: seg(L2) });
for (const x of [id(2), id(3)]) await svc.generateArtifact(db, { transcriptionId: x, kind: 'study_guide' });
const g = await svc.guideAcrossRecordings(db, { ids: [id(2), id(3)], userId: U, requestId: '7d7d7d7d-0000-4000-8000-000000000002' });
ok(g.saved && g.item.kind === 'guide' && /Lecture 6 refines Lecture 5/.test(g.item.content.themes[0].comparison || ''), 'a combined guide is saved too, and shown with current titles');
ok(/\{\{R2\}\} refines \{\{R1\}\}/.test(db._x.at(-1).content.themes[0].comparison) && !('recordings' in db._x.at(-1).content), 'stored guide: tokens, not titles');
const h = await X.historySets(db);
ok(h.sets.length === 2 && h.sets[0].guides === 1 && h.sets[1].asks === 1 && h.sets[1].lastQuestion === 'Does osmosis need ATP?', 'history lists each selection with saved work, newest first');
ok(h.sets.every((s2) => s2.recordings.every((x) => x.available && x.title)), 'with each recording’s current title');
db.acrossSaveError = 'error';
const failed = await svc.askAcrossRecordings(db, { ids: [id(2), id(3)], question: 'What uses ATP?', userId: U });
ok(!failed.saved && failed.saveError === 'error' && failed.item.content.answer && db._x.length === 2, 'a failed save still returns the answer, marked as not saved (nothing is lost on screen)');
db.acrossSaveError = null;
ok((await X.deleteItem(db, db._x[0].id)).deleted && db._x.length === 1, 'an item can be deleted');
ok((await err(X.deleteItem(db, '7d7d7d7d-0000-4000-8000-00000000dead')))?.status === 404 && (await err(X.deleteItem(db, 'nope')))?.status === 400, 'deleting an unknown or malformed id → 404 / 400');
// downgraded: saved work stays readable, new work needs Thunder
db.plan = 'bolt';
ok((await X.threadFor(db, [id(2), id(3)])).items.length === 1 && (await X.historySets(db)).sets.length === 1, 'after a downgrade, saved answers and guides stay readable');
ok((await err(svc.askAcrossRecordings(db, { ids: [id(2), id(3)], question: 'x', userId: U })))?.code === 'plan_required', '…but asking again needs Thunder');
console.log = quiet;
console.log(`\n${pass} checks passed`);
