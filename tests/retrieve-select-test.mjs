// Choosing which lines of a long recording Ask sees (server/ai/retrieve.js): bm25, needsRetrieval, selectContext, formatExcerpts.
import assert from 'node:assert/strict';
const R = await import(new URL('../server/ai/retrieve.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); pass++; console.log('ok -', msg); };

// ---- bm25
const chunks = [{ text: 'budget meeting finance plan' }, { text: 'holiday cooking recipes' }, { text: 'budget budget budget' }];
const scores = R.bm25(chunks, new Map([['budget', 1]]));
ok(scores[1] === 0, 'a chunk without the term scores 0');
ok(scores[0] > 0 && scores[2] > scores[0], 'a chunk that says the term more often scores higher');
const doubled = R.bm25(chunks, new Map([['budget', 2]]));
ok(Math.abs(doubled[0] - 2 * scores[0]) < 1e-9, 'scores scale with the term weight');
eq(R.bm25(chunks, new Map([['zzz', 1]])), [0, 0, 0], 'a term nobody uses scores everything 0');
eq(R.bm25([], new Map([['a', 1]])), [], 'no chunks, no scores');

// ---- a long recording: 400 lines of filler with two lines that matter
const seg = [];
for (let i = 0; i < 400; i++) seg.push({ id: i, start: i * 10, end: i * 10 + 9, speaker: i % 2 ? 'Lee' : 'Dana', text: ('filler talk about weather and lunch number ' + i + ' ').repeat(2).trim() });
seg[200].text = 'The quarterly budget deficit needs approval';
seg[300].text = 'Lee mentioned the zebra migration plan';

ok(R.needsRetrieval(seg) === true, 'a recording of this size needs retrieval');
const short = seg.slice(0, 6);
ok(R.needsRetrieval(short) === false, 'a short recording does not');
const full = R.selectContext(short, { question: 'anything' });
ok(full.mode === 'full' && full.ids.join() === '0,1,2,3,4,5', 'a short recording is sent whole, in order');

let r = R.selectContext(seg, { question: 'What about the budget deficit?' });
ok(r.mode === 'retrieval' && r.ids.length < seg.length, 'a long recording is cut down');
ok(r.ids.includes(200), 'the line that matches the question is included');
ok(r.ids.includes(199) && r.ids.includes(201), 'the lines around the best match come with it');
ok(!r.ids.includes(300), 'a line that does not match is left out');
ok(r.ids.every((id, i) => i === 0 || id > r.ids[i - 1]), 'chosen ids are in time order');

r = R.selectContext(seg, { question: 'tell me', keywords: ['zebra'] });
ok(r.ids.includes(300) && !r.ids.includes(200), 'keywords from query expansion pull in matching lines too');
r = R.selectContext(seg, { question: 'explain this part', at: 1500 });
ok(r.ids.includes(150), 'a question about "this part" includes the lines at the playback position');
r = R.selectContext(seg, { question: 'nothing', priorityIds: [50] });
ok(r.ids.includes(50), 'priority ids are kept');
r = R.selectContext(seg, { question: 'zzzqqq' });
ok(r.mode === 'retrieval' && r.ids.length === 0, 'a question that matches nothing selects no lines');
r = R.selectContext(seg, { question: 'budget', budget: 100 });
ok(r.ids.length === 0, 'a chunk bigger than the token budget is not taken');

// ---- formatExcerpts
const line = (s) => `L${s.id}`;
ok(R.formatExcerpts(seg, [0, 1, 4, 5], line) === 'L0\nL1\n…\nL4\nL5', 'a gap between chosen lines is marked with …');
ok(R.formatExcerpts(seg, [3, 4, 5], line) === 'L3\nL4\nL5', 'consecutive lines have no marker');
ok(R.formatExcerpts(seg, [], line) === '', 'no lines gives an empty string');
ok(R.formatExcerpts(seg, [7], undefined).startsWith('[7] '), 'by default each line is written as the model sees it ([id] clock speaker: text)');

console.log(`${pass} checks passed`);
