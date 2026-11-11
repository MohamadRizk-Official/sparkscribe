// Practice Quiz run state (src/insights/quiz-engine.js): queue building, option order, scoring, retake-missed, summary.
import assert from 'node:assert/strict';
const Q = await import(new URL('../src/insights/quiz-engine.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

const questions = [
  { type: 'multiple_choice', question: 'Capital of France?', options: ['Rome', 'Paris', 'Oslo', 'Bern'], answer: 'Paris' },
  { type: 'true_false', question: 'Water boils at 100 C at sea level.', options: ['True', 'False'], answer: 'True' },
  { type: 'multiple_choice', question: '2 + 2?', options: ['3', '4', '5'], answer: '4' },
  { type: 'short_answer', question: 'Name the process plants use to make food.', answer: 'photosynthesis', options: [] },
];

// ---- newRun ----
let run = Q.newRun(questions);
ok(run.kind === 'full' && run.items.length === 4 && run.i === 0 && !run.done, 'a full run has every question, starts at 0, not done');
ok(run.items.map((x) => x.qi).join() === '0,1,2,3', 'items keep stored question order');
ok(run.items[0].order.join() === '0,1,2,3' && run.items[3].order.length === 0, 'without shuffle options keep their natural order');

const sh = Q.newRun(questions, { shuffle: true });
ok([...sh.items[0].order].sort().join() === '0,1,2,3', 'a shuffled multiple-choice order is a permutation of its options');
ok(sh.items[1].order.join() === '0,1', 'True / False keep their natural order even when shuffling');

const missed = Q.newRun(questions, { only: [2, 0, 99] });
ok(missed.kind === 'missed' && missed.items.map((x) => x.qi).join() === '2,0', 'retake-only keeps the given order and drops unknown indices');
ok(Q.newRun(questions, { only: [] }).kind === 'full', 'an empty "only" list means a full run');
ok(Q.newRun(questions, { only: [1], kind: 'focus' }).kind === 'focus', 'an explicit kind wins');

// ---- answering ----
ok(Q.currentItem(run).qi === 0, 'currentItem is the first item');
ok(Q.answer(run, questions, 'Paris') === true, 'correct choice is graded right');
ok(run.answers[0].correct && run.answers[0].verdict === 'correct', 'answer is recorded with a verdict');
ok(Q.advance(run) === false && run.i === 1, 'advance moves on and reports not last');
ok(Q.answer(run, questions, 'False') === false, 'wrong choice is graded wrong');
ok(run.answers[1].verdict === 'incorrect', 'wrong answer verdict is "incorrect"');
Q.overrideCorrect(run);
ok(run.answers[1].correct && run.answers[1].overridden && run.answers[1].verdict === 'correct', 'overrideCorrect flips a wrong answer and marks it overridden');
Q.advance(run);
Q.answer(run, questions, '5');
ok(Q.answeredCount(run) === 3 && Q.correctCount(run) === 2, 'answeredCount / correctCount count recorded answers');
Q.advance(run);
Q.record(run, 'some idea', { verdict: 'close', typo: true });
ok(run.answers[3].correct === true && run.answers[3].typo === true, 'a "close" short answer counts as right');
ok(Q.advance(run) === true && run.done, 'advance on the last item finishes the run');
ok(run.i === 3, 'the index stays on the last item');

// ---- summary ----
const sum = Q.summary(run);
ok(sum.strong.join() === '0,1,3' && sum.missed.join() === '2', 'summary splits stored question indices into strong and missed');
ok(sum.score === 3 && sum.total === 4, 'summary score and total');
const retake = Q.newRun(questions, { only: sum.missed });
ok(retake.items.length === 1 && retake.items[0].qi === 2, 'a retake built from the summary has only the missed question');

// unanswered items count as missed
const fresh = Q.newRun(questions);
ok(Q.summary(fresh).missed.length === 4 && Q.summary(fresh).score === 0, 'unanswered questions count as missed');
Q.record(fresh, 'x', { verdict: 'incorrect' });
ok(fresh.answers[0].correct === false, 'record with an "incorrect" verdict is not correct');
Q.overrideCorrect(Q.newRun(questions)); // no answer yet: must not throw
ok(true, 'overrideCorrect with no answer yet does nothing');

console.log(`${pass} checks passed`);
