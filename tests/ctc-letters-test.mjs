// lettersOf and the alignment settings in src/lib/ctc-align.js: which characters of a word reach the aligner.
//   node tests/ctc-letters-test.mjs
import assert from 'node:assert/strict';
import { lettersOf, ALIGN_SETTINGS, TAKEOVER_S } from '../src/lib/ctc-align.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

const vocab = { '<pad>': 0, '|': 4, A: 5, B: 6, C: 7, "'": 8 };
ok(lettersOf('abc', vocab).join('') === 'ABC', 'letters are upper-cased before the vocabulary lookup');
ok(lettersOf('a-b!c', vocab).join('') === 'ABC', 'characters the vocabulary does not know are dropped');
ok(lettersOf("a'b", vocab).join('') === "A'B", 'an apostrophe in the vocabulary is kept');
ok(lettersOf('a|b', vocab).join('') === 'AB', 'the word separator is never treated as a letter');
ok(lettersOf('', vocab).length === 0, 'an empty word has no letters');
ok(lettersOf('xyz', vocab).length === 0, 'a word with no known letters has none');
ok(lettersOf(42, { 4: 1, 2: 2 }).join('') === '42', 'a number is read as its text');
ok(lettersOf(null, vocab).join('') === '', 'null is read as the text "null", whose letters are not in this vocabulary');
ok(ALIGN_SETTINGS.lead === 'wildcard' && ALIGN_SETTINGS.gaps === 'wildcard', 'the production alignment lets speech before and between words be absorbed');
ok(ALIGN_SETTINGS.wildcardLogP < 0 && Math.abs(ALIGN_SETTINGS.wildcardLogP - Math.log(0.3)) < 1e-12, 'the wildcard costs log(0.3) per frame');
ok(TAKEOVER_S === 0.5, 'the takeover window is half a second');
console.log(`\n${pass} checks passed`);
