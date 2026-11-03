// "…" at a speaker change inside a sentence (src/lib/continuation.js): only the display is marked, words untouched.
//   node tests/continuation-test.mjs
import assert from 'node:assert/strict';
import { continuationMarks } from '../src/lib/continuation.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const l = (start, end, speaker, text) => ({ start, end, speaker, text });

const m = continuationMarks([l(0, 2, 'A', 'I think we should'), l(2, 4, 'B', 'go to the beach.'), l(4, 6, 'A', 'Yes.'), l(6.5, 8, 'B', 'and then lunch')]);
ok(m[0].cut && m[1].cont, 'one person stops mid-sentence and the other carries on: both parts marked');
ok(!m[1].cut && !m[2].cont, 'a finished sentence is not a cut');
ok(!m[2].cut && !m[3].cont, 'a pause between the parts is not a cut');
const same = continuationMarks([l(0, 2, 'A', 'so we went'), l(2, 4, 'A', 'home')]);
ok(!same[0].cut && !same[1].cont, 'the same person going on is not marked');
const capital = continuationMarks([l(0, 2, 'A', 'What is this'), l(2, 4, 'B', 'I know')]);
ok(!capital[0].cut, 'a part starting with a capital is not taken as the same sentence');

console.log(`\n${pass} checks passed`);
