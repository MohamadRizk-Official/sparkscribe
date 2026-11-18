// digestOf and mapOf (server/ai/across.js) against a tiny fake database: which stored results count as current, what
// the digest keeps, and that mapOf picks the newest current study map. No network, no AI.
//   node tests/across-digest-test.mjs
import assert from 'node:assert/strict';
const { digestOf, mapOf } = await import(new URL('../server/ai/across.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

const segments = [0, 1, 2].map((id) => ({ id, start: id * 5, end: id * 5 + 4, speaker: 'Maya', text: `line ${id}` }));
const rec = { id: 'r1', version: 3, basis: { text: 'x', parts: [0, 0, 0] }, segments, speakers: [] };
const db = (insights = [], artifacts = []) => ({ listInsights: async () => insights, listArtifacts: async () => artifacts });
const overview = (over = {}) => ({ kind: 'overview', status: 'ready', source_version: 3, content: { short_summary: 'A short summary.', key_points: [{ text: 'First point', refs: [0, 1] }] }, ...over });

ok(await digestOf(db([]), rec) === null, 'no stored overview: no digest');
ok(await digestOf(db([overview({ status: 'running' })]), rec) === null, 'an overview that is not ready is ignored');
ok(await digestOf(db([overview({ source_version: 2 })]), rec) === null, 'an overview made for an older transcript version is not current');
ok(await digestOf(db([{ ...overview(), kind: 'notes' }]), rec) === null, 'only the overview kind is used');
ok(await digestOf(db([overview({ content: null })]), rec) === null, 'an overview without content is ignored');

const d = await digestOf(db([overview()]), rec);
ok(d.summary === 'A short summary.' && d.points.length === 1 && d.points[0].text === 'First point', 'a current overview gives its summary and points');
ok(d.points[0].refs.join() === '0,1', 'the points keep their line references');

const mixed = overview({ content: { short_summary: 'S', key_points: [
  { text: 'Keeps only real lines', refs: [1, 99, -4] },
  { text: 'All refs unknown', refs: [77] },
  { text: '', refs: [0] },
  { text: 'No refs at all' },
] } });
const m = await digestOf(db([mixed]), rec);
ok(m.points.length === 1 && m.points[0].refs.join() === '1', 'unknown line ids are dropped, and points left without a valid line, a text or any refs are dropped');

const many = overview({ content: { short_summary: 'S', key_points: Array.from({ length: 200 }, (_, i) => ({ text: `Point number ${i} `.repeat(6), refs: [0] })) } });
const trimmed = await digestOf(db([many]), rec);
ok(trimmed.points.length > 0 && trimmed.points.length < 200, 'a long overview is cut to a token budget, not kept whole');
ok(trimmed.points[0].text.startsWith('Point number 0') && trimmed.points.at(-1).text.startsWith(`Point number ${trimmed.points.length - 1} `), 'the cut keeps the first points in order');

// ---- mapOf
const map = (id, updated, over = {}) => ({ id, status: 'ready', source_version: 3, updated_at: updated, content: { engine: 3, map: { concepts: [{ id: 'c1', name: id }] }, speakers: undefined }, ...over });
ok(await mapOf(db([], []), rec) === null, 'no artifacts: no map');
ok(await mapOf(db([], [map('old', '2026-01-01', { content: { engine: 2, map: { concepts: [{ id: 'c1' }] } } })]), rec) === null, 'a map from study engine 2 is not used');
ok(await mapOf(db([], [map('empty', '2026-01-01', { content: { engine: 3, map: { concepts: [] } } })]), rec) === null, 'a map with no concepts is not used');
ok(await mapOf(db([], [map('stale', '2026-01-01', { source_version: 1 })]), rec) === null, 'a map for an older transcript version is not current');
const newest = await mapOf(db([], [map('first', '2026-01-01'), map('second', '2026-03-01'), map('third', '2026-02-01')]), rec);
ok(newest.concepts[0].name === 'second', 'with several current maps the most recently updated one is used');
console.log(`\n${pass} checks passed`);
