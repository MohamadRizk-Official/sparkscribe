// Prompt builders and stored-map lookup for the study map pipeline (server/ai/studymap.js, server/ai/studyrun.js):
// sectionInstructions, consolidateInstructions, writeInstructions, composeInstructions, storedMap.
import assert from 'node:assert/strict';
const M = await import(new URL('../server/ai/studymap.js', import.meta.url).href);
const R = await import(new URL('../server/ai/studyrun.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

ok(M.STUDY_ENGINE_3 === 3 && M.SECTION_TOKENS === 6000 && R.MAP_WAIT_MS === 90000, 'engine 3, 6000-token sections and a 90 s map wait');

// ---- sectionInstructions ----
const si = M.sectionInstructions({ index: 1, total: 4, from: 40, to: 79 });
ok(si.includes('SECTION (2 of 4, 40–79)'), 'the section is numbered from 1 with its line range');
ok(si.includes('<section>') && si.includes('<context_before>'), 'the prompt separates the section from its context');
ok(/educational = false/.test(si), 'logistics and small talk are marked not educational');
ok(/misrecognized/.test(si), 'misrecognised names must not be guessed');
ok(si.includes('returns empty lists'), 'a section with nothing to learn returns empty lists');

// ---- consolidateInstructions ----
const entries = [
  { key: 's0.c1', topic: 'Osmosis', importance: 'core', kind: 'definition', stance: 'own', held_by: null, name: 'Osmosis', summary: 'Water crosses a membrane.' },
  { key: 's1.c2', topic: 'Views', importance: 'supporting', kind: 'argument', stance: 'attributed', held_by: 'Keynes', name: 'Spending view', summary: 'Demand drives output.' },
];
const ci = M.consolidateInstructions(entries);
ok(ci.includes('<entries>') && ci.includes('</entries>'), 'entries are wrapped in tags');
ok(ci.includes('s0.c1 | Osmosis | core | definition | own | Osmosis: Water crosses a membrane.'), 'an entry is one line: key, topic, importance, kind, stance, name and summary');
ok(ci.includes('attributed (Keynes)'), 'who holds an attributed view is shown');
ok(ci.includes('every key in exactly one topic'), 'every key must be in exactly one topic');

// ---- writeInstructions ----
const concepts = [{ id: 'c1', topic: 't1', name: 'Osmosis', kind: 'definition', importance: 'core', stance: 'own', held_by: null, summary: 's', reasoning: 'r' }];
const topics = [{ id: 't1', title: 'Water' }];
const wq = M.writeInstructions('quiz', { concepts, topics, settings: {}, dominant: null, tfLimit: 0 });
ok(wq.startsWith('Write exactly one question for each concept'), 'a quiz writes one question per concept');
ok(wq.includes('"topic": "Water"') && wq.includes('"id": "c1"'), 'concepts are listed with their topic title');
ok(wq.includes('"summary": "s"') && wq.includes('"reasoning": "r"'), 'each concept brings its summary and reasoning');
ok(wq.includes('No true_false in this set.'), 'with no true/false allowance the quiz says so');
ok(wq.includes('exactly 4 options'), 'quiz questions have four options');
const wf = M.writeInstructions('flashcards', { concepts, topics: [], settings: { focus: 'deep' }, dominant: 'S1' });
ok(wf.startsWith('Write exactly one flashcard for each concept'), 'flashcards write one card per concept');
ok(wf.includes('"topic": ""'), 'a concept whose topic is unknown has an empty topic title');
ok(wf.includes('front: one clear question') && wf.includes('FOCUS: deep understanding'), 'flashcards ask for a front and back');
ok(wf.includes('{{S1}} gives almost all'), 'the dominant speaker note is added');
ok(wq.includes('Standard level') && M.writeInstructions('quiz', { concepts, topics, settings: { difficulty: 'harder' }, tfLimit: 0 }).includes('Challenge level'), 'quiz difficulty comes from the settings');

// ---- composeInstructions ----
const map = { topics: [{ id: 't1', title: 'Water', importance: 'major' }], concepts: [
  { id: 'c1', topic: 't1', name: 'Osmosis', importance: 'core', stance: 'own', held_by: null },
  { id: 'c2', topic: 't1', name: 'Trivia', importance: 'minor', stance: 'own', held_by: null },
] };
const co = R.composeInstructions(map, 'balanced');
ok(co.includes('"name": "Osmosis"'), 'the study map\'s concepts are given to the guide writer');
ok(!co.includes('Trivia'), 'minor concepts are left out of the guide prompt');
ok(co.includes('Never add facts the map doesn\'t contain'), 'the guide may only use the map');

// ---- storedMap ----
const basis = { n: 1 };
const art = (over) => ({ status: 'ready', updated_at: '2026-01-01', content: { engine: 3, map: { concepts: [{}] }, basis }, ...over });
ok(R.storedMap([], basis) === null, 'no artifacts, no stored map');
ok(R.storedMap([art({ status: 'pending' })], basis) === null, 'a map still being written is not used');
ok(R.storedMap([art({ content: { engine: 2, map: { concepts: [{}] }, basis } })], basis) === null, 'an older engine\'s output is not a map');
ok(R.storedMap([art({ content: { engine: 3, map: {}, basis } })], basis) === null, 'a map with no concepts is not used');
const newer = art({ updated_at: '2026-05-01' });
ok(R.storedMap([art(), newer, art({ updated_at: '2026-03-01' })], basis) === newer, 'the most recently updated map wins');

console.log(`${pass} checks passed`);
