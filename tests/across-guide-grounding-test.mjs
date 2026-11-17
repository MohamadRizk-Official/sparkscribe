// Combined study guide grounding (server/ai/across.js groundGuide, guideInstructions): every item must rest on concepts
// that exist, recordings are labelled by token, and limits are exported.
import assert from 'node:assert/strict';
const X = await import(new URL('../server/ai/across.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

ok(X.MIN_RECORDINGS === 2 && X.ASK_MAX_RECORDINGS === 12 && X.GUIDE_MAX_RECORDINGS === 10, 'across limits: at least 2, ask up to 12, guide up to 10 recordings');

const rec = (label, title, speakers = {}) => ({ id: `id-${label}`, label, title, speakers: new Map(Object.entries(speakers)), segments: [{ start: 0 }, { start: 12.5 }, { start: 30 }] });
const r1 = rec('R1', 'Biology Lecture 2', { 'R1.S1': 'Speaker 1' });
const r2 = rec('R2', 'Biology Lecture 5');
const recs = [r1, r2];
const known = new Map([
  ['R1.c1', { rec: r1, concept: { name: 'Osmosis', refs: [1] } }],
  ['R2.c1', { rec: r2, concept: { name: 'Osmosis revisited', refs: [2] } }],
  ['R2.c2', { rec: r2, concept: { name: 'Active transport', refs: [] } }],
]);

const json = {
  overview: 'R1 and R2 both cover osmosis.',
  themes: [
    { title: 'Osmosis', summary: 'Water moves across a membrane; see R2.', comparison: 'R2 corrects R1.', concepts: ['R2.c1', 'R1.c1', 'R1.c1'] },
    { title: 'Invented', summary: 'No such concept', concepts: ['R9.c9'] },
    { title: 'Transport', summary: 'Needs energy', concepts: [' R2.c2 '] },
  ],
  definitions: [{ term: 'Osmosis', definition: 'Water movement', concepts: ['R1.c1'] }, { term: 'Ghost', definition: 'x', concepts: ['nope'] }],
  distinctions: [{ text: 'Osmosis vs active transport', concepts: ['R1.c1', 'R2.c2'] }, { text: 'no sources', concepts: [] }],
  self_check: [{ question: 'Why no ATP?', answer: 'It moves down a gradient', concepts: ['R2.c1'] }],
};
const { content, dropped } = X.groundGuide(json, known, recs);

ok(content.themes.length === 2, 'a theme with no existing concept is dropped');
ok(dropped === 5, 'every dropped item and unknown concept reference is counted');
const osm = content.themes[0];
ok(osm.sources.map((s) => s.key).join() === 'R2.c1,R1.c1', 'a repeated concept appears once, in the order the model gave');
ok(osm.recordings.join() === 'R1,R2', 'a theme lists its recordings in recording order');
ok(osm.sources[1].label === 'R1' && osm.sources[1].transcriptionId === 'id-R1' && osm.sources[1].title === 'Biology Lecture 2' && osm.sources[1].concept === 'Osmosis', 'a source carries its recording and concept');
ok(osm.sources[1].line === 1 && osm.sources[1].start === 12.5, 'a source points at the concept\'s first line and its start time');
const transport = content.themes[1];
ok(transport.sources[0].key === 'R2.c2' && transport.sources[0].line === null && transport.sources[0].start === 0, 'a concept with no lines points at no line and starts at 0');
ok(content.overview === '{{R1}} and {{R2}} both cover osmosis.', 'recording labels in text become tokens');
ok(osm.summary === 'Water moves across a membrane; see {{R2}}.' && osm.comparison === '{{R2}} corrects {{R1}}.', 'summary and comparison are tokenised too');
ok(content.themes[1].comparison === null, 'a theme with no comparison keeps null');
ok(content.definitions.length === 1 && content.definitions[0].term === 'Osmosis', 'a definition with no valid concept is dropped');
ok(content.distinctions.length === 1 && content.distinctions[0].sources.length === 2, 'a distinction with no sources is dropped');
ok(content.self_check.length === 1 && content.self_check[0].sources[0].label === 'R2', 'self-check items keep their sources');
ok(content.recurring === 1, 'only themes spanning two or more recordings count as recurring');

const empty = X.groundGuide({}, known, recs);
ok(empty.dropped === 0 && empty.content.themes.length === 0 && empty.content.overview === '', 'an empty guide grounds to empty content');

// ---- guideInstructions ----
const gi = X.guideInstructions(['block A', 'block B'], 'balanced');
ok(gi.includes('study maps of 2 recordings') && gi.includes('block A') && gi.includes('block B'), 'the prompt includes every recording\'s map');
ok(gi.includes('{{R2}}') && gi.includes('Never add facts the maps'), 'the prompt asks for label tokens and forbids new facts');
ok(!/examined on/.test(gi), 'a balanced guide does not focus on exams');
ok(/examined on/.test(X.guideInstructions(['b'], 'exam')), 'an exam guide favours what is likely to be examined');

console.log(`${pass} checks passed`);
