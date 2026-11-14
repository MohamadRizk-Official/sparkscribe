// Exam prep helpers (src/home/exam.js): countdown, topic parsing, the study plan built from a course's records, and the pace.
// The module imports the Supabase client, so it is loaded through tests/vite-env-hook.mjs (no keys: "not configured").
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./vite-env-hook.mjs', import.meta.url);
const E = await import(new URL('../src/home/exam.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

// ---- daysUntil: whole calendar days from "today" (the local date) to an ISO date
const now = new Date(2026, 10, 14, 23, 59); // 14 Nov 2026, late evening, local time
ok(E.daysUntil('2026-11-14', now) === 0, 'the exam is today');
ok(E.daysUntil('2026-11-15', now) === 1, 'tomorrow is 1 day away even late in the evening');
ok(E.daysUntil('2026-11-13', now) === -1, 'yesterday is -1');
ok(E.daysUntil('2026-12-14', now) === 30, 'a month ahead is counted in calendar days');
ok(E.daysUntil('2027-11-14', now) === 365, 'a year ahead');
ok(E.daysUntil('2026-11-14', new Date(2026, 10, 14, 0, 1)) === 0, 'the time of day does not matter');

// ---- inDays
ok(E.inDays(0) === 'today' && E.inDays(1) === 'tomorrow' && E.inDays(2) === 'in 2 days' && E.inDays(30) === 'in 30 days', 'countdown wording');

// ---- fmtExamDate always names the day (locale-dependent text, so only stable parts are checked)
const label = E.fmtExamDate('2026-11-20');
ok(/20/.test(label) && label.length > 5, 'the formatted date contains the day of the month');

// ---- parseTopics
ok(E.parseTopics('cell biology, mitosis; Krebs cycle').join('|') === 'cell biology|mitosis|Krebs cycle', 'commas and semicolons separate topics');
ok(E.parseTopics('one\ntwo\n\nthree').join('|') === 'one|two|three', 'new lines separate topics and blank lines are skipped');
ok(E.parseTopics('Mitosis, mitosis, MITOSIS').join('|') === 'Mitosis', 'repeats are dropped regardless of case, the first spelling stays');
ok(E.parseTopics('a, bb, ccc').join('|') === 'bb|ccc', 'single characters are dropped');
ok(E.parseTopics('x'.repeat(200))[0].length === 80, 'a topic is cut to 80 characters');
ok(E.parseTopics(Array.from({ length: 25 }, (_, i) => `topic ${i}`).join(',')).length === 10, 'at most 10 topics');
ok(E.parseTopics('').length === 0 && E.parseTopics(null).length === 0 && E.parseTopics(undefined).length === 0, 'nothing in, nothing out');
ok(E.parseTopics('  spaced  ,').join('|') === 'spaced', 'whitespace is trimmed');

// ---- buildPlan
const lec = (o) => ({ id: o.id, title: o.id, kinds: new Set(o.kinds || []), missed: 0, hasQuiz: false, quizTaken: false, due: 0, ...o });
ok(E.buildPlan([]).length === 0, 'no lectures, no steps');
const plan = E.buildPlan([
  lec({ id: 'bare' }),                                                                        // no study material
  lec({ id: 'quizzed', kinds: ['quiz'], missed: 3, hasQuiz: true, quizTaken: true }),          // missed questions
  lec({ id: 'cards', kinds: ['flashcards'], due: 1 }),                                         // one card due
  lec({ id: 'fresh', kinds: ['quiz'], hasQuiz: true, quizTaken: false }),                      // quiz not taken
  lec({ id: 'done', kinds: ['study_guide'], hasQuiz: true, quizTaken: true }),                 // nothing to do
  lec({ id: 'notes-only', kinds: ['summary', 'notes'] }),                                      // notes are not study material
]);
ok(plan.map((s) => s.lecture.id).join() === 'bare,notes-only,quizzed,cards,fresh', 'steps are ordered: no material, missed, due, untaken quiz; finished lectures give none');
ok(plan[0].text === 'Make flashcards or a practice quiz' && plan[0].tool === null && plan[0].why === 'No study material yet', 'a lecture with no study material is asked for flashcards or a quiz');
ok(plan[2].text === 'Retake 3 missed questions' && plan[2].tool === 'quiz', 'missed questions are pluralised and open the quiz');
ok(plan[3].text === 'Review 1 flashcard' && plan[3].tool === 'flashcards', 'one due card is singular');
ok(plan[4].text === 'Take the practice quiz' && plan[4].why === 'Made, not taken yet', 'a made-but-untaken quiz is offered last');
ok(E.buildPlan([lec({ id: 'x', kinds: ['quiz'], missed: 1, hasQuiz: true })])[0].text === 'Retake 1 missed question', 'one missed question is singular');
ok(E.buildPlan([lec({ id: 'a', kinds: ['definitions'], missed: 2, due: 4, hasQuiz: true })]).map((s) => s.tool).join() === 'quiz,flashcards,quiz', 'one lecture can need several steps');

// ---- pace: steps per day, leaving the last day free
ok(E.pace(10, 6) === 2, '10 steps over 6 days (5 working days) is 2 a day');
ok(E.pace(7, 3) === 4, 'rounds up');
ok(E.pace(5, 2) === 5, 'two days left: everything on the first day');
ok(E.pace(5, 1) === null && E.pace(5, 0) === null && E.pace(5, -3) === null, 'the day before or after: no pace');
ok(E.pace(0, 5) === null, 'no steps: no pace (0 counts as missing)');
ok(E.pace(null, 5) === null, 'a missing step count gives null');
console.log(`${pass} checks passed`);
