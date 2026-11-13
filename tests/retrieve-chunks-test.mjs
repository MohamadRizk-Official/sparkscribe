// How a long transcript is prepared for Ask (server/ai/retrieve.js): tokenize and buildChunks.
import assert from 'node:assert/strict';
const R = await import(new URL('../server/ai/retrieve.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); pass++; console.log('ok -', msg); };

// ---- tokenize
eq(R.tokenize('The Meetings were held; Parties and cities!'), ['meeting', 'held', 'party', 'city'], 'lower-cased, stop words dropped, simple plurals stemmed (ies -> y)');
eq(R.tokenize('a 7 x'), [], 'single-character tokens are dropped');
eq(R.tokenize('Café ÉCOLE'), ['café', 'école'], 'letters beyond ASCII are kept and lower-cased');
eq(R.tokenize(''), [], 'empty text has no tokens');
eq(R.tokenize('Budget 2025 plan'), ['budget', '2025', 'plan'], 'numbers are tokens');
ok(R.tokenize('mention explain recording please').length === 0, 'question filler (mention, explain, recording, please) is a stop word');
eq(R.tokenize('cats'), ['cats'], 'words under 5 letters are not stemmed');

// ---- buildChunks
const seg = (id, start, end, speaker, text) => ({ id, start, end, speaker, text });
const even = Array.from({ length: 6 }, (_, i) => seg(i, i * 30, i * 30 + 25, i % 2 ? 'Lee' : 'Dana', 'word '.repeat(10).trim()));
const chunks = R.buildChunks(even);
eq(chunks.map((c) => c.ids), [[0, 1], [2, 3], [4, 5]], 'a chunk closes once it would span more than 75 seconds');
ok(chunks[0].start === 0 && chunks[0].end === 55 && chunks[1].start === 60, 'a chunk runs from its first line start to its last line end');
ok(chunks[0].words === 20, 'words are counted per chunk');
eq([...chunks[0].speakers], ['dana', 'lee'], 'speakers are collected lower-cased');

const wordy = [seg(0, 0, 10, 'A', 'w '.repeat(100).trim()), seg(1, 10, 20, 'A', 'w '.repeat(100).trim())];
eq(R.buildChunks(wordy).map((c) => c.ids), [[0], [1]], 'a chunk also closes before it would exceed 170 words');
eq(R.buildChunks([]), [], 'no segments, no chunks');
ok(R.buildChunks(even).every((c) => c.text.startsWith(' ')), 'chunk text is the lines joined, each preceded by a space');

console.log(`${pass} checks passed`);
