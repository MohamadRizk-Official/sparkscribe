// Edge cases of engine/merge.js mergeOverlap: empty sides, punctuation/case, fuzzy match, cut-off word, maxWords.
import assert from 'node:assert/strict';
import { mergeOverlap } from '../src/engine/merge.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

let r = mergeOverlap('', 'hello there');
ok(r.removed === 0 && r.a === '' && r.b === 'hello there', 'an empty A leaves both sides untouched');
r = mergeOverlap('hello there', '   ');
ok(r.removed === 0 && r.a === 'hello there' && r.b === '', 'a blank B leaves both sides untouched');
r = mergeOverlap('we went to the store', 'To the Store, and then home');
ok(r.removed === 3 && r.b === 'and then home', 'the overlap ignores case and punctuation, and is removed from B only');
r = mergeOverlap('we met yesterday', 'tomorrow is another day');
ok(r.removed === 0 && r.b === 'tomorrow is another day', 'no shared words: nothing removed');
r = mergeOverlap('so then', 'the next thing');
ok(r.removed === 0, 'a single short repeated word is not trusted as an overlap');
r = mergeOverlap('see you later', 'later we can talk');
ok(r.removed === 1 && r.b === 'we can talk', 'a single repeated word of 4+ letters counts as an overlap');
r = mergeOverlap('one two three four five', 'one two three four five six');
ok(r.removed === 5 && r.b === 'six', 'a whole-A overlap removes every repeated word');
r = mergeOverlap('alpha beta gamma delta epsilon', 'alpha beta gamma delta zeta eta');
ok(r.removed === 5 && r.b === 'eta', 'a 5-word overlap with a single differing word is still merged');
r = mergeOverlap('x the quick brown fox', 'the quick brown box jumps');
ok(r.removed === 4 && r.b === 'jumps', 'a 4-word overlap with one mismatch is accepted');
r = mergeOverlap('the quick brown', 'the quick crown jumps');
ok(r.removed === 0, 'a 3-word overlap with a mismatch is not accepted');
r = mergeOverlap('we need the budg', 'budget is tight');
ok(r.removed === 1 && r.a === 'we need the' && r.b === 'budget is tight', 'a word cut off at the boundary is dropped from A, B keeps the whole word');
r = mergeOverlap('a b c d e f g h', 'g h i', 1);
ok(r.removed === 0, 'maxWords caps how long an overlap is searched for');
r = mergeOverlap('  spaced   out  text ', 'out text more');
ok(r.a === 'spaced out text' && r.b === 'more', 'extra whitespace is normalised in the result');
console.log(`${pass} checks passed`);
