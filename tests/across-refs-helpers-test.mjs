// Helpers of src/lib/across-refs.js not covered by across-test.mjs: acrossSpeakers and mapStrings.
import assert from 'node:assert/strict';
const A = await import(new URL('../src/lib/across-refs.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); pass++; console.log('ok -', msg); };

const segs = [
  { id: 0, speaker: 'Dana', orig: 'Speaker 1', text: 'a', start: 0 },
  { id: 1, speaker: 'Lee', orig: 'Speaker 2', text: 'b', start: 5 },
];
eq([...A.acrossSpeakers('R2', segs)], [['R2.S1', 'Dana'], ['R2.S2', 'Lee']], 'speaker codes are prefixed with the recording label and map to current names');
eq([...A.acrossSpeakers('R1', [])], [], 'a recording with no segments has no speaker codes');

const upper = (s) => s.toUpperCase();
eq(A.mapStrings({ a: 'x', n: [{ t: 'y' }] }, upper), { a: 'X', n: [{ t: 'Y' }] }, 'every string in a nested result is transformed');
const kept = A.mapStrings({ sources: 'keep', key: 'k', label: 'L', transcriptionId: 'id', concept: 'c', text: 'go' }, upper);
eq(kept, { sources: 'keep', key: 'k', label: 'L', transcriptionId: 'id', concept: 'c', text: 'GO' }, 'snapshot and reference fields are left as they are');
eq(A.mapStrings({ refs: ['z'], count: 3, flag: true, none: null }, upper), { refs: ['z'], count: 3, flag: true, none: null }, 'refs, numbers, booleans and null are untouched');
eq(A.mapStrings({ refs: ['a', 'b'], sources: 'abc' }, upper), { refs: ['a', 'b'], sources: 'abc' }, 'a skipped key keeps a string and an array of strings');
ok(A.mapStrings('plain', upper) === 'PLAIN', 'a bare string is transformed');

console.log(`${pass} checks passed`);
