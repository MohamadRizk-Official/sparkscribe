// Across recordings (server/ai/across.js) with the in-memory store and the mock provider: who can read what, how
// passages are chosen within a budget, citation grounding, the one-at-a-time guard, usage limits, failures, and the
// combined study guide built from stored study maps.
import assert from 'node:assert/strict';
import { memoryStore } from './memory-store.mjs';
process.env.AI_PROVIDER = 'mock';
const root = new URL('../', import.meta.url).href;
const svc = await import(root + 'server/ai/service.js');
const X = await import(root + 'server/ai/across.js');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const err = async (p) => { try { await p; return null; } catch (e) { return e; } };
const quiet = console.log; console.log = (...a) => { if (!String(a[0]).startsWith('[ai-usage]')) quiet(...a); };

const U = '11111111-1111-4111-8111-111111111111';
const id = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const seg = (lines) => lines.map(([sp, t], i) => ({ s: i * 20, e: i * 20 + 18, sp, t }));
const db = memoryStore({ userId: U });
db.plan = 'thunder';
// three short lectures, recorded on different days (seeded out of order), one meeting, and someone else's recording
db.seed({ id: id(2), user_id: U, created_at: '2026-10-08T10:00:00Z', title: 'Biology Lecture 5', duration_seconds: 120, transcript_text: 'x', recording_type: 'lecture', segments: seg([
  ['Speaker 1', 'Today we revisit osmosis, the movement of water across a membrane.'],
  ['Speaker 1', 'Correction from last week: osmosis does not need energy from ATP.'],
  ['Speaker 1', 'The exam will ask you to compare osmosis and active transport.'],
]) });
db.seed({ id: id(1), user_id: U, created_at: '2026-10-01T10:00:00Z', title: 'Biology Lecture 2', duration_seconds: 120, transcript_text: 'x', recording_type: 'lecture', segments: seg([
  ['Speaker 1', 'Osmosis is the movement of water across a membrane.'],
  ['Speaker 1', 'I said osmosis uses energy from ATP, like a pump.'],
  ['Speaker 1', 'Mitochondria produce most of the cell energy.'],
]) });
db.seed({ id: id(3), user_id: U, created_at: '2026-10-09T10:00:00Z', title: 'Team sync', duration_seconds: 90, transcript_text: 'x', recording_type: 'meeting', segments: seg([
  ['Speaker 1', 'We decided to launch the beta on Monday.'],
  ['Speaker 2', 'I will send the pricing table by Friday.'],
]) });
db.seed({ id: id(9), user_id: '99999999-9999-4999-8999-999999999999', created_at: '2026-10-02T10:00:00Z', title: 'Private', duration_seconds: 60, transcript_text: 'x', recording_type: 'lecture', segments: seg([['Speaker 1', 'Secret osmosis notes from another user.']]) });

// ---------- the collection ----------
ok((await err(X.loadCollection(db, [id(1)], { max: 12 })))?.code === 'bad_request', 'one recording is not a collection (at least 2)');
ok((await err(X.loadCollection(db, Array.from({ length: 13 }, (_, i) => id(100 + i)), { max: 12 })))?.code === 'too_many', 'more than 12 recordings → refused before reading anything');
const foreign = await err(X.loadCollection(db, [id(1), id(9)], { max: 12 }));
ok(foreign?.code === 'not_found' && foreign.details.missing.join() === id(9) && !/Private|Secret/.test(foreign.message), "another user's recording id → not found, named only by the id the user sent (no title or text leaks)");
const gone = await err(X.loadCollection(db, [id(1), id(77)], { max: 12 }));
ok(gone?.code === 'not_found' && gone.details.missing.join() === id(77), 'a deleted recording → not found, with its id so the page can remove it');
const recs = await X.loadCollection(db, [id(2), id(1), 'not-a-uuid', id(2)], { max: 12 });
ok(recs.map((r) => `${r.label}=${r.title}`).join() === 'R1=Biology Lecture 2,R2=Biology Lecture 5', 'labels follow recording order (oldest = R1), duplicates and malformed ids ignored');

// ---------- citations ----------
const allowed = new Map([['R1', new Set([0, 1])], ['R2', new Set([1])]]);
const g = X.groundAcross('Osmosis used ATP [R1:1]. Later corrected [R2:1, R1:0]. Invented [R2:7]. Bare number [R1:0, 1].', allowed);
ok(g.answer.includes('[R1:1]') && g.answer.includes('[R2:1, R1:0]') && !g.answer.includes('R2:7') && g.invalid === 1, 'citations of lines the model was given stay; others are removed');
ok(g.answer.includes('[R1:0, R1:1]') && g.refs.length === 3, '"[R1:0, 1]" continues the same recording');
ok(X.parseCites('R3:4; R1:2').map((c) => c.label + c.line).join() === 'R34,R12', 'citation groups parse across recordings');

// ---------- choosing passages (long collection) ----------
const long = (n, topicLine) => Array.from({ length: 400 }, (_, i) => ({ id: i, start: i * 10, end: i * 10 + 9, speaker: 'Speaker 1', text: i === 200 ? topicLine : `Filler sentence number ${i} about unrelated scheduling and logistics of recording ${n}.` }));
const big = [1, 2, 3, 4, 5].map((n) => ({ label: `R${n}`, segments: long(n, n === 4 ? 'Nothing relevant here at all.' : `The photosynthesis light reactions happen in the thylakoid, lecture ${n}.`) }));
const sel = X.selectAcross(big, { question: 'Where do the photosynthesis light reactions happen?' });
const tok = (s) => Math.ceil(`[R00:${s.id}] 00:00 ${s.speaker}: ${s.text}`.length / 3.2) + 1;
const spent = [...sel.ids].reduce((t, [label, ids]) => t + ids.reduce((u, i) => u + tok(big.find((r) => r.label === label).segments[i]), 0), 0);
ok(sel.mode === 'retrieval' && spent <= X.EXCERPT_BUDGET, `a 5-recording collection is searched, not sent whole (${spent} ≤ ${X.EXCERPT_BUDGET} tokens)`);
ok(['R1', 'R2', 'R3', 'R5'].every((l) => sel.ids.get(l).includes(200)), 'every recording with a matching passage is represented by it');
ok(!sel.ids.get('R4').includes(200), 'a recording without a match gets no passage on that topic');
ok(X.selectAcross(recs, { question: 'osmosis' }).mode === 'full', 'short collections are sent whole (cheaper, and nothing can be missed)');

// ---------- the plan: Thunder only, checked before anything is read or reserved ----------
for (const plan of ['free', 'flash', 'bolt']) {
  db.plan = plan;
  const n = db._ai.length;
  const ea = await err(svc.askAcrossRecordings(db, { ids: [id(2), id(1)], question: 'Does osmosis need ATP?', userId: U }));
  const eg = await err(svc.guideAcrossRecordings(db, { ids: [id(2), id(1)], userId: U }));
  ok(ea?.code === 'plan_required' && ea.status === 403 && ea.details.plan === 'thunder' && ea.details.capability === 'across_ask' && eg?.code === 'plan_required' && eg.details.capability === 'across_guide' && db._ai.length === n,
    `${plan}: asking across and combined guides are refused with the plan that has them (Thunder); no AI call, nothing reserved`);
}
ok((await err(svc.askAcrossRecordings(db, { ids: [id(1), id(9)], question: 'x', userId: U })))?.code === 'plan_required', "the plan is checked before the recordings: a refused user learns nothing about the ids they sent");
db.plan = 'thunder';
db.entitlementsError = 'billing_status failed';
const unk = await err(svc.askAcrossRecordings(db, { ids: [id(2), id(1)], question: 'x', userId: U }));
ok(unk?.code === 'plan_unavailable' && unk.status === 503, 'the plan cannot be read → refused (never treated as entitled)');
db.entitlementsError = null;

// ---------- ask across ----------
const events = [];
const a0 = await svc.askAcrossRecordings(db, { ids: [id(2), id(1)], question: 'Does osmosis need energy from ATP?', userId: U }, (e) => events.push(e.type));
const a = { ...a0.item.content, recordings: a0.item.recordings };
ok(a.refs.some((r) => r.label === 'R1') && a.refs.some((r) => r.label === 'R2'), 'the answer cites both recordings');
ok(!a.answer.includes('R9:999') && a.refs.every((r) => [id(1), id(2)].includes(r.transcriptionId)), 'a citation of a recording that was never given is removed');
const r2 = a.refs.find((r) => r.label === 'R2');
ok(r2.title === 'Biology Lecture 5' && Number.isFinite(r2.start) && r2.line >= 0, 'each source names its recording and the passage time (to open it)');
ok(events.includes('delta') && events.includes('names') && a.recordings.map((r) => r.label).join() === 'R1,R2', 'the answer is streamed, and lists the recordings in order');
ok(db._ai.some((x) => x.feature === 'across:ask' && x.status === 'done'), 'the question is reserved and settled in the AI usage ledger');
const none = (await svc.askAcrossRecordings(db, { ids: [id(1), id(3)], question: 'What did they say about quantum chromodynamics?', userId: U })).item.content;
ok(none.refs.length === 0 && none.unsupported === false, 'nothing relevant → an uncited “not mentioned” answer, not a made-up one');

// ---------- guards ----------
db._ai.push({ id: 900, feature: 'across:ask', status: 'reserved', at: Date.now() }, { id: 901, feature: 'across:ask', status: 'reserved', at: Date.now() });
const busy = await err(svc.askAcrossRecordings(db, { ids: [id(2), id(1)], question: 'Osmosis?', userId: U }));
ok(busy?.code === 'busy' && busy.status === 429, 'two questions already running → the third waits (one expensive request at a time, per user)');
db._ai = db._ai.filter((x) => x.id < 900);
db.aiLimits = { perHour: 0, budget: 10 };
ok((await err(svc.askAcrossRecordings(db, { ids: [id(2), id(1)], question: 'Osmosis?', userId: U })))?.code === 'rate_limited', 'usage limits apply exactly as for every AI feature');
db.aiLimits = { perHour: 100, budget: 1 };
ok((await err(svc.askAcrossRecordings(db, { ids: [id(2), id(1)], question: 'Osmosis?', userId: U })))?.code === 'quota_exceeded', 'the monthly AI budget applies too');
db.aiLimits = null;
process.env.AI_MOCK_FAIL = '1';
const failed = await err(svc.askAcrossRecordings(db, { ids: [id(2), id(1)], question: 'Osmosis?', userId: U }));
delete process.env.AI_MOCK_FAIL;
ok(failed && db._ai.at(-1).status === 'failed', 'an AI failure surfaces as an error and is settled as failed (no cost recorded)');

// ---------- combined study guide ----------
const needs = await err(svc.guideAcrossRecordings(db, { ids: [id(1), id(2)], userId: U }));
ok(needs?.code === 'needs_maps' && needs.details.needs.length === 2, 'recordings without a study map are named, so the page can create their study guides first');
for (const t of [id(1), id(2)]) await svc.generateArtifact(db, { transcriptionId: t, kind: 'study_guide' });
const before = db._ai.length;
const gd0 = await svc.guideAcrossRecordings(db, { ids: [id(1), id(2)], userId: U });
const gd = { content: gd0.item.content, dropped: gd0.dropped };
ok(db._ai.length === before + 1, 'the combined guide is one AI call (the maps are reused, not rebuilt)');
ok(gd.content.themes.length && !gd.content.themes.some((t) => t.title === 'Invented theme') && gd.dropped >= 1, 'an item resting on a concept that doesn’t exist is dropped');
const shared = gd.content.themes.find((t) => t.title === 'Shared idea');
ok(shared.recordings.join() === 'R1,R2' && gd.content.recurring >= 1, 'which recordings a theme appears in is computed from its sources (recurring = 2 or more)');
ok(shared.sources.every((s) => [id(1), id(2)].includes(s.transcriptionId) && s.line != null), 'every source points at a recording and a line');
// edited transcript: its map is out of date → needed again
db.seed({ id: id(2), user_id: U, created_at: '2026-10-08T10:00:00Z', title: 'Biology Lecture 5', duration_seconds: 120, transcript_text: 'x', recording_type: 'lecture', segments: seg([['Speaker 1', 'A completely different lecture text now.'], ['Speaker 1', 'About cell walls.']]) });
const stale = await err(svc.guideAcrossRecordings(db, { ids: [id(1), id(2)], userId: U }));
ok(stale?.code === 'needs_maps' && stale.details.needs.join() === id(2), 'a recording edited since its study map was made needs a new one (old concepts are never used)');
const st = await X.collectionStatus(db, [id(1), id(2)]);
ok(st.recordings.find((r) => r.id === id(1)).hasMap && !st.recordings.find((r) => r.id === id(2)).hasMap, 'status says which recordings are ready, without any AI call');
console.log = quiet;
console.log(`\n${pass} checks passed`);
