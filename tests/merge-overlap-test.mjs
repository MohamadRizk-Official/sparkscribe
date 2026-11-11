// Joining overlapping chunk transcripts (src/engine/merge.js mergeOverlap).
import assert from 'node:assert/strict';
const { mergeOverlap } = await import(new URL('../src/engine/merge.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

let r = mergeOverlap('we will meet at the library today', 'at the library today and then go home');
ok(r.removed === 4 && r.b === 'and then go home', 'a repeated 4-word tail is removed from the start of B');
ok(r.a === 'we will meet at the library today', 'A is kept whole');

r = mergeOverlap('see you on Monday', 'monday, we start chapter two');
ok(r.removed === 1 && r.b === 'we start chapter two', 'one long repeated word is merged, case and punctuation ignored');

r = mergeOverlap('and so on', 'on we go');
ok(r.removed === 0 && r.b === 'on we go', 'a single short repeated word is not treated as an overlap');

r = mergeOverlap('first part ends here', 'something else entirely');
ok(r.removed === 0 && r.a === 'first part ends here' && r.b === 'something else entirely', 'no overlap leaves both sides alone');

r = mergeOverlap('the committee reviewed the budget proposal carefully', 'the budget proposal carefully and approved it');
ok(r.removed === 4 && r.b === 'and approved it', 'the longest match wins');

r = mergeOverlap('one two three four five six', 'one two three four five six seven');
ok(r.removed === 6 && r.b === 'seven', 'a whole-chunk overlap leaves only the new words');

r = mergeOverlap('please review the quarterly sales numbers', 'the quarterly sales numbers and forecast');
ok(r.removed === 4, 'overlap in the middle of A tail is found by length');

r = mergeOverlap('they decided on the new buildxng plan', 'on the new building plan was ready');
ok(r.removed === 5 && r.b === 'was ready', 'one mismatched word is tolerated in an overlap of 4+ words');
r = mergeOverlap('so the new buildxng', 'the new building plan');
ok(r.removed === 0, 'a mismatch is not tolerated in an overlap shorter than 4 words');

r = mergeOverlap('and then the budg', 'budget is the main issue');
ok(r.removed === 1 && r.a === 'and then the' && r.b === 'budget is the main issue', 'a word cut off at the boundary is replaced by the whole word in B');

r = mergeOverlap('', 'hello there');
ok(r.removed === 0 && r.a === '' && r.b === 'hello there', 'empty A returns B trimmed');
r = mergeOverlap('  hello there  ', '   ');
ok(r.removed === 0 && r.a === 'hello there' && r.b === '', 'empty B returns A trimmed');

r = mergeOverlap('x a b c d e f g h i j k l m n o p', 'a b c d e f g h i j k l m n o p q', 3);
ok(r.removed === 0, 'maxWords caps the overlap length searched');

r = mergeOverlap('Café déjà vu', 'DÉJÀ vu again');
ok(r.removed === 2 && r.b === 'again', 'Unicode letters are compared case-insensitively');

console.log(`${pass} checks passed`);
