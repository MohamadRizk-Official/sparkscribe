// Instant short-answer checking in the browser (src/insights/tools.js localGrade, shortAnswerCorrect): the same words
// ignoring case, punctuation, filler words, spacing, plurals and obvious typos. Anything else is left to the server.
import assert from 'node:assert/strict';
import { localGrade, shortAnswerCorrect } from '../src/insights/tools.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const q = (answer, accept = []) => ({ answer, accept });

let g = localGrade('Mitochondria', q('mitochondria'));
ok(g && g.verdict === 'correct' && g.typo === false, 'the same word in another case is correct, not a typo');
ok(localGrade('  The Mitochondria! ', q('mitochondria'))?.typo === false, 'filler words, punctuation and spaces are ignored');
ok(localGrade('door dash', q('DoorDash'))?.verdict === 'correct', 'spacing: "door dash" equals "DoorDash"');
ok(localGrade('DoorDash', q('door dash'))?.verdict === 'correct', '…the other way round too');
ok(localGrade('cells', q('cell'))?.verdict === 'correct', 'a plural matches the singular');
ok(localGrade('cell', q('cells'))?.verdict === 'correct', 'a singular matches the plural');
ok(localGrade('categories', q('category'))?.verdict === 'correct', '"-ies" and "-y" match');
ok(localGrade('boxes', q('box'))?.verdict === 'correct', '"-xes" and "-x" match');
ok(localGrade('class', q('classes'))?.verdict === 'correct', '"class" is not cut down to "clas" and matches "classes"');

g = localGrade('shiping', q('shipping'));
ok(g?.verdict === 'correct' && g.typo === true, 'one wrong letter in a longer word is correct but flagged as a typo');
ok(localGrade('cat', q('cut')) === null, 'a short word must be exact: "cat" is not "cut"');
ok(localGrade('mitochondrion', q('mitochondria'))?.typo === true, 'a long word may differ by a letter');
ok(localGrade('photosynthsis', q('photosynthesis'))?.typo === true, 'a missing letter in a long word is a typo');
ok(localGrade('phtsynthss', q('photosynthesis')) === null, 'too many wrong letters is not a match');

// several words: three quarters of the expected words are enough
ok(localGrade('red blue green', q('red blue green yellow'))?.verdict === 'correct', 'three of four expected words is enough');
ok(localGrade('red blue', q('red blue green yellow')) === null, 'two of four expected words is not');
ok(localGrade('blue red green yellow', q('red blue green yellow'))?.verdict === 'correct', 'the order of the words does not matter');
ok(localGrade('red', q('red')) !== null, 'a single expected word that is given is correct');

// accepted alternatives
ok(localGrade('powerhouse', q('mitochondria', ['powerhouse of the cell'])) === null, 'one word of a three-word alternative is not enough');
ok(localGrade('powerhouse of the cell', q('mitochondria', ['powerhouse of the cell']))?.verdict === 'correct', 'the full alternative is correct');
ok(localGrade('nucleus', q('mitochondria', ['powerhouse of the cell'])) === null, 'something else is left for the server to judge');

// nothing to compare
ok(localGrade('', q('x')) === null, 'an empty answer is never marked');
ok(localGrade('   ', q('x')) === null, 'a blank answer is never marked');
ok(localGrade('the of', q('x')) === null, 'an answer of only filler words is never marked');
ok(localGrade(null, q('x')) === null && localGrade(undefined, q('x')) === null, 'a missing answer is never marked');
ok(localGrade('x', q('')) === null, 'an expected answer with no words matches nothing');
ok(localGrade('x', { answer: 'x' })?.verdict === 'correct', 'a question with no "accept" list still works');

// shortAnswerCorrect is the yes/no form
ok(shortAnswerCorrect('cells', q('cell')) === true, 'shortAnswerCorrect: yes for a match');
ok(shortAnswerCorrect('nothing', q('cell')) === false, 'shortAnswerCorrect: no for a miss');
ok(shortAnswerCorrect('', q('cell')) === false, 'shortAnswerCorrect: no for an empty answer');

console.log(`${pass} checks passed`);
