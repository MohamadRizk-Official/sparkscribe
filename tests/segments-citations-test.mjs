// Citation handling in src/lib/segments.js: citedIds, splitCitations, modelLine, estimateTokens.
import assert from 'node:assert/strict';
const S = await import(new URL('../src/lib/segments.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); pass++; console.log('ok -', msg); };

eq(S.citedIds('It was Friday [3].'), [3], 'a single citation');
eq(S.citedIds('Both [12, 15] agree [15][20].'), [12, 15, 20], 'groups and adjacent citations, distinct, in order');
eq(S.citedIds('[2] then [1] then [2]'), [2, 1], 'first-appearance order, no repeats');
eq(S.citedIds('no citations here'), [], 'no citations -> empty');
eq(S.citedIds('array[x] and [a, b]'), [], 'non-numeric brackets are not citations');

const valid = (n) => n < 10;
eq(S.splitCitations('Due Friday [3].', valid), [{ text: 'Due Friday ' }, { refs: [3] }, { text: '.' }], 'text, citation, text');
eq(S.splitCitations('A [3, 99] B', valid), [{ text: 'A ' }, { refs: [3] }, { text: ' B' }], 'invalid ids are dropped from a group');
eq(S.splitCitations('plain', valid), [{ text: 'plain' }], 'text without citations is one part');
eq(S.splitCitations('', valid), [], 'empty text -> no parts');

ok(S.modelLine({ id: 12, start: 221, speaker: 'Speaker 1', text: 'Hello.' }) === '[12] 3:41 Speaker 1: Hello.', 'modelLine format is "[id] clock speaker: text"');
ok(S.estimateTokens('') === 0, 'empty text is 0 tokens');
ok(S.estimateTokens('abcd') === 2 && S.estimateTokens('a'.repeat(32)) === 10, 'tokens are ceil(chars / 3.2)');

console.log(`${pass} checks passed`);
