// insights/quiz-engine.js: building a run, scoring, overriding and summarising, on small hand-made quizzes.
import assert from 'node:assert/strict';
import * as Q from '../src/insights/quiz-engine.js';

let pass = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); pass++; console.log('ok -', m); };

const questions = [
  { type: 'multiple_choice', question: 'q0', options: ['a', 'b', 'c', 'd'], answer: 'b' },
  { type: 'true_false', question: 'q1', options: ['True', 'False'], answer: 'True' },
  { type: 'multiple_choice', question: 'q2', options: ['x', 'y', 'z'], answer: 'z' },
];

let run = Q.newRun(questions);
eq(run.kind, 'full', 'a normal run is "full"');
eq(run.items.map((i) => i.qi), [0, 1, 2], 'a full run has every question in order');
eq(run.items[0].order, [0, 1, 2, 3], 'without shuffle the options keep their order');
eq([run.i, run.done, run.answers], [0, false, []], 'a new run starts at the first item, not done');

run = Q.newRun(questions, { only: [2, 9, 0] });
eq(run.kind, 'missed', 'retaking chosen questions makes a "missed" run');
eq(run.items.map((i) => i.qi), [2, 0], 'unknown question indices are skipped');
eq(Q.newRun(questions, { only: [] }).kind, 'full', 'an empty "only" list means a full run');
eq(Q.newRun(questions, { only: [1], kind: 'focus' }).kind, 'focus', 'an explicit kind wins');

const sh = Q.newRun(questions, { shuffle: true });
eq([...sh.items[0].order].sort(), [0, 1, 2, 3], 'a shuffled multiple-choice order is a permutation');
eq(sh.items[1].order, [0, 1], 'true/false options are never shuffled');
eq(Q.newRun([{ type: 'short_answer' }]).items[0].order, [], 'a question without options has an empty order');

run = Q.newRun(questions);
eq(Q.answer(run, questions, 'b'), true, 'the exact correct choice scores');
eq(Q.answer(run, questions, 'B'), false, 'a choice must match exactly');
eq(run.answers[0], { given: 'B', correct: false, verdict: 'incorrect' }, 'the answer is stored on the current item, replacing the earlier one');
eq(Q.advance(run), false, 'advancing from the first item is not the end');
Q.answer(run, questions, 'False');
Q.advance(run);
Q.answer(run, questions, 'z');
eq([Q.answeredCount(run), Q.correctCount(run)], [3, 1], 'answered and correct counts');
eq(Q.advance(run), true, 'advancing past the last item reports the end');
eq(run.done && run.i === 2, true, 'the run is marked done and stays on the last item');
eq(Q.summary(run), { strong: [2], missed: [0, 1], score: 1, total: 3 }, 'the summary lists strong and missed question indices');
Q.overrideCorrect(run);
eq(run.answers[2].overridden, true, 'overriding marks the current answer as overridden');
run.i = 1; Q.overrideCorrect(run);
eq(Q.correctCount(run), 2, 'an override turns an incorrect answer correct');
const fresh = Q.newRun(questions);
Q.overrideCorrect(fresh);
eq(fresh.answers, [], 'overriding before any answer does nothing');
Q.record(fresh, 'my idea', { verdict: 'close' });
eq(fresh.answers[0], { given: 'my idea', correct: true, verdict: 'close', typo: false }, 'a "close" verdict counts as correct');
Q.record(fresh, 'no', { verdict: 'incorrect', typo: true });
eq(fresh.answers[0].correct, false, 'an "incorrect" verdict does not');
eq(Q.summary(Q.newRun(questions)), { strong: [], missed: [0, 1, 2], score: 0, total: 3 }, 'unanswered items count as missed');
console.log(`${pass} checks passed`);
