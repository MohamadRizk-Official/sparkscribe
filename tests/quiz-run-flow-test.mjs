// Practice Quiz run lifecycle (src/insights/quiz-engine.js): start, answer, advance, summary, then retake only the missed.
import assert from 'node:assert/strict';
const Q = await import(new URL('../src/insights/quiz-engine.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

const questions = [
  { type: 'multiple_choice', question: 'Capital of France?', options: ['Paris', 'Rome', 'Oslo', 'Bern'], answer: 'Paris' },
  { type: 'true_false', question: 'The sun is a star.', options: ['True', 'False'], answer: 'True' },
  { type: 'multiple_choice', question: '2 + 2?', options: ['3', '4', '5'], answer: '4' },
];

// ---- a fresh run
const run = Q.newRun(questions);
ok(run.kind === 'full' && run.items.length === 3 && run.i === 0 && !run.done, 'a new run is a full run at the first item, not done');
ok(run.items.every((it, k) => it.qi === k), 'items follow the stored question order');
ok(run.items[0].order.join() === '0,1,2,3' && run.items[1].order.join() === '0,1', 'without shuffle the option order is the stored order');
ok(Q.answeredCount(run) === 0 && Q.correctCount(run) === 0, 'nothing is answered yet');

// ---- answering and advancing
ok(Q.answer(run, questions, 'Paris') === true, 'the exact correct option is right');
ok(Q.answeredCount(run) === 1 && Q.correctCount(run) === 1, 'one answered, one correct');
ok(Q.advance(run) === false && run.i === 1 && !run.done, 'advance moves to the next item');
ok(Q.answer(run, questions, 'False') === false, 'a wrong True/False answer is wrong');
ok(run.answers[1].given === 'False' && run.answers[1].verdict === 'incorrect', 'the given answer and verdict are recorded');
ok(Q.advance(run) === false, 'advance to the last item');
ok(Q.answer(run, questions, '3') === false, 'a wrong multiple-choice answer is wrong');
ok(Q.advance(run) === true && run.done && run.i === 2, 'advancing past the last item finishes the run and stays on it');

// ---- the learner says the answer was right
Q.overrideCorrect(run);
ok(run.answers[2].correct && run.answers[2].overridden && run.answers[2].verdict === 'correct', 'overrideCorrect flips the current answer and marks it overridden');

const s = Q.summary(run);
ok(s.score === 2 && s.total === 3, 'score counts the override');
ok(s.strong.join() === '0,2' && s.missed.join() === '1', 'strong and missed list stored question indices');

// ---- retake only what was missed
const retake = Q.newRun(questions, { only: s.missed });
ok(retake.kind === 'missed' && retake.items.length === 1 && retake.items[0].qi === 1, 'retaking the missed question gives a "missed" run of one item');
ok(Q.newRun(questions, { only: [] }).kind === 'full', 'an empty "only" list is a full run');
ok(Q.newRun(questions, { only: [1, 99] }).items.length === 1, 'indices with no stored question are skipped');
ok(Q.newRun(questions, { only: [0], kind: 'focus' }).kind === 'focus', 'an explicit kind wins');

// ---- an unanswered item counts as missed
const partial = Q.newRun(questions);
Q.answer(partial, questions, 'Paris');
const ps = Q.summary(partial);
ok(ps.score === 1 && ps.missed.join() === '1,2', 'questions never answered are listed as missed');

// ---- overrideCorrect with no answer yet does nothing
const fresh = Q.newRun(questions);
Q.overrideCorrect(fresh);
ok(fresh.answers.length === 0, 'overrideCorrect before an answer is a no-op');

console.log(`\n${pass} checks passed`);
