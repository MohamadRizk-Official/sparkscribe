// Reusing a stored study map (server/ai/studyrun.js: storedMap, studyMap, MAP_WAIT_MS, composeInstructions).
// No AI is called: `call` is a function that fails the test if it is ever used, and the database is a small in-memory stand-in.
import assert from 'node:assert/strict';
const S = await import(new URL('../server/ai/studyrun.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

const basis = { n: 12, text: 'abc', parts: 'p1' };
const map = { topics: [{ id: 't1', title: 'Cells', importance: 'major' }], concepts: [{ id: 'c1', topic: 't1', name: 'Mitosis', summary: 'Cell division.', importance: 'core', stance: 'own', held_by: null, reasoning: 'Needed for growth.' }] };
const art = (over = {}) => ({ kind: 'study_map', status: 'ready', updated_at: '2026-01-02T00:00:00Z', content: { engine: 3, basis, map, quality: { sections: 2 } }, ...over });
const noCall = async () => { throw new Error('the AI must not be called'); };

// ---- storedMap
ok(S.MAP_WAIT_MS === 90_000, 'a map being built is waited for up to 90 seconds');
ok(S.storedMap([art()], basis).content.map === map, 'a ready engine-3 map for the same words and speakers is found');
ok(S.storedMap([], basis) === null, 'no results: no stored map');
ok(S.storedMap([art({ status: 'generating' })], basis) === null, 'a map still being built is not usable yet');
ok(S.storedMap([art({ status: 'failed' })], basis) === null, 'a failed map is not usable');
ok(S.storedMap([art({ content: { engine: 2, basis, map } })], basis) === null, 'a map from an older engine is not reused');
ok(S.storedMap([art({ content: { engine: 3, basis } })], basis) === null, 'a result with no map is not a map');
ok(S.storedMap([art({ content: { engine: 3, basis, map: {} } })], basis) === null, '…and neither is one whose map has no concepts');
ok(S.storedMap([art()], { ...basis, text: 'changed' }) === null, 'a map made from different words is not reused');
ok(S.storedMap([art()], { ...basis, parts: 'p2' }) === null, 'nor one made with different speakers');
ok(S.storedMap([art()], undefined) === null, 'with no basis nothing matches');
const newer = art({ updated_at: '2026-03-01T00:00:00Z', content: { engine: 3, basis, map: { ...map, topics: [] } } });
ok(S.storedMap([art(), newer], basis) === newer && S.storedMap([newer, art()], basis) === newer, 'when several match, the most recently updated one wins');
ok(S.storedMap([art({ kind: 'quiz' })], basis) !== null, 'any engine-3 result that carries the map counts, whatever its kind');

// ---- studyMap reuses without asking the AI
let lists = 0;
const db = (arts) => ({ async listArtifacts() { lists++; return arts; } });
const r = await S.studyMap({ db: db([art()]), transcriptionId: 't', segments: [], speakers: {}, basis, call: noCall });
ok(r.reused === true && r.map === map && r.sections === 2 && lists === 1, 'a stored map is returned as reused, with its section count, after one read');
const r2 = await S.studyMap({ db: db([art({ content: { engine: 3, basis, map } })]), transcriptionId: 't', segments: [], speakers: {}, basis, call: noCall });
ok(r2.reused === true && r2.sections === null, 'a map saved without quality notes reports no section count');

// a map being prepared right now is waited for, then reused (the wait polls every 1.5 s; one poll here)
lists = 0;
const building = art({ status: 'generating', content: null, updated_at: new Date().toISOString() });
const polling = { async listArtifacts() { lists++; return lists === 1 ? [building] : [art()]; } };
const t0 = Date.now();
const r3 = await S.studyMap({ db: polling, transcriptionId: 't', segments: [], speakers: {}, basis, call: noCall });
ok(r3.reused === true && lists === 2 && Date.now() - t0 >= 1400, 'a map being built ahead of time is polled for, then reused instead of being paid for twice');

// ---- composeInstructions
const text = S.composeInstructions(map, 'balanced');
ok(text.includes('<map>') && text.includes('"Mitosis"') && text.includes('"Cells"'), 'the writing instructions carry the topics and their ideas');
ok(!text.includes('examined on'), 'the exam hint appears only for the exam focus');
ok(S.composeInstructions(map, 'exam').includes('likely be examined on') && S.composeInstructions(map, 'exam').includes('never claim something will be on an exam'), 'the exam focus asks for likely exam material but forbids promising it');
const withMinor = { topics: map.topics, concepts: [...map.concepts, { id: 'c2', topic: 't1', name: 'Trivia', summary: 's', importance: 'minor' }] };
ok(!S.composeInstructions(withMinor, 'balanced').includes('Trivia'), 'minor ideas are left out of the instructions');
ok(S.composeInstructions(map, 'balanced').includes('Never add facts the map doesn\'t contain.'), 'the writer is told to add no facts beyond the map');
ok(S.COMPOSE_SCHEMA && S.COMPOSE_SCHEMA.properties && Object.keys(S.COMPOSE_SCHEMA.properties).sort().join() === 'overview,self_check,topic_summaries', 'the guide schema asks for an overview, topic summaries and self-check questions');

console.log(`${pass} checks passed`);
