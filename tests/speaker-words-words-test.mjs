// wordsOf and the tuned constants in src/engine/speaker-words.js (the values were chosen on development recordings,
// so a change to them should be deliberate and show up here).
//   node tests/speaker-words-words-test.mjs
import assert from 'node:assert/strict';
import { wordsOf, MIN_RUN_S, MIN_WORDS, SNAP_WORDS } from '../src/engine/speaker-words.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

ok(wordsOf('a b c').join('|') === 'a|b|c', 'words split on single spaces');
ok(wordsOf('  a \n\t b  ').join('|') === 'a|b', 'leading, trailing and mixed whitespace is ignored');
ok(wordsOf('').length === 0 && wordsOf('   ').length === 0, 'empty and blank text have no words');
ok(wordsOf(null).length === 0 && wordsOf(undefined).length === 0, 'null and undefined have no words');
ok(wordsOf('What is this? I').length === 4, 'punctuation stays attached to its word');
ok(wordsOf(12.5).join() === '12.5', 'a number is read as its text');
ok(MIN_RUN_S === 0.5 && MIN_WORDS === 1 && SNAP_WORDS === 1, 'minimum run 0.5 s, minimum 1 word, snap 1 word');
console.log(`\n${pass} checks passed`);
