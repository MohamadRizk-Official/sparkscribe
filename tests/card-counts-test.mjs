// How many cards / questions a tool asks for: cardCount (server/ai/tools.js) and quizQuestionCount
// (src/lib/tool-settings.js). Both are ceilings that follow the recording's length.
//   node tests/card-counts-test.mjs
import assert from 'node:assert/strict';
import { cardCount, questionCount } from '../server/ai/tools.js';
import { quizQuestionCount } from '../src/lib/tool-settings.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

ok(cardCount(5, 'standard') === 8 && cardCount(9.9, 'standard') === 8, 'under 10 minutes: 8 cards');
ok(cardCount(10, 'standard') === 15 && cardCount(39.9, 'standard') === 15, '10 to 40 minutes: 15 cards');
ok(cardCount(40, 'standard') === 25 && cardCount(180, 'standard') === 25, '40 minutes and longer: 25 cards');
ok(cardCount(5, 'fewer') === 5, '"fewer" never goes below 5 cards');
ok(cardCount(20, 'fewer') === 8 && cardCount(60, 'fewer') === 13, '"fewer" is about half');
ok(cardCount(5, 'more') === 13 && cardCount(20, 'more') === 24, '"more" is about 1.6 times');
ok(cardCount(60, 'more') === 40, '"more" never goes above 40 cards');
ok(cardCount(20, undefined) === 15 && cardCount(20, 'bogus') === 15, 'an unknown size is the standard size');
ok(quizQuestionCount(2, 'standard') === 5 && quizQuestionCount(30, 'standard') === 10, 'quiz: 5 questions under 5 minutes, otherwise 10');
ok(quizQuestionCount(2, 'fewer') === 3 && quizQuestionCount(30, 'fewer') === 5, 'quiz "fewer": 3 for short recordings, 5 otherwise');
ok(quizQuestionCount(2, 'more') === 8 && quizQuestionCount(30, 'more') === 15, 'quiz "more": 8 for short recordings, 15 otherwise');
ok(quizQuestionCount(4.99, 'standard') === 5 && quizQuestionCount(5, 'standard') === 10, 'the short-recording cut-off is exactly 5 minutes');
ok(questionCount === quizQuestionCount, 'the server and the browser share one question-count function');
console.log(`\n${pass} checks passed`);
