// Focused Review (src/insights/focus-review.js): which concepts a learner should review after a quiz, from what
// evidence, and how the state survives retries, flags, speaker renames and the size limit of `progress`.
import assert from 'node:assert/strict';
import { readState, recordRun, markReviewed, flagQuestion, reviewList, counts, openConcepts, practiceItems, needsNewQuestions, withState, allQuestions, supportsReview, compact, STATE } from '../src/insights/focus-review.js';
import { resolveContent } from '../src/lib/speaker-refs.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

// a quiz as study engine 3 stores it: a map and questions that name their concept
const content = {
  map: {
    topics: [{ id: 't1', title: 'Cell division', importance: 'major' }, { id: 't2', title: 'Energy', importance: 'major' }],
    concepts: [
      { id: 'c1', topic: 't1', name: 'Mitosis', summary: 'Mitosis makes two identical cells.', reasoning: null, refs: [3, 4], evidence: 'two identical cells', stance: 'own', held_by: null },
      { id: 'c2', topic: 't1', name: 'Meiosis', summary: '{{S2}} explained that meiosis halves the chromosomes.', reasoning: 'for reproduction', refs: [8], evidence: 'halves', stance: 'own', held_by: null },
      { id: 'c3', topic: 't2', name: 'ATP', summary: 'ATP stores energy.', reasoning: null, refs: [12], evidence: 'stores energy', stance: 'own', held_by: null },
    ],
  },
  questions: [
    { concept: 'c1', type: 'multiple_choice', question: 'Q0 mitosis', answer: 'A', options: ['A', 'B', 'C', 'D'] },
    { concept: 'c2', type: 'multiple_choice', question: 'Q1 meiosis', answer: 'A', options: ['A', 'B', 'C', 'D'] },
    { concept: 'c3', type: 'short_answer', question: 'Q2 ATP', answer: 'energy' },
    { concept: 'c2', type: 'true_false', question: 'Q3 meiosis again', answer: 'True', options: ['True', 'False'] },
    { concept: 'c3', type: 'multiple_choice', question: 'Q4 ATP misheard', answer: 'A', options: ['A', 'B', 'C', 'D'], caution: 'Check the recording: “adenosine” may be misheard.' },
  ],
  speakers: { S2: { name: 'Speaker 2', lines: [[8, 8]] } },
};
const ids = new Set(content.map.concepts.map((c) => c.id));
const qs = allQuestions(content);
const run = (answers) => ({ items: answers.map(([qi]) => ({ qi })), answers: answers.map(([, a]) => a) });
const R = { correct: true, verdict: 'correct' }, W = { correct: false, verdict: 'incorrect' };

ok(supportsReview(content) && !supportsReview({ questions: [{ question: 'x' }] }), 'only quizzes with a study map and concept ids get a Focused Review');
ok(Object.keys(readState(null).c).length === 0 && Object.keys(readState({ review: { v: 99, c: { c1: { s: 'review' } } } }).c).length === 0, 'missing or unknown review data starts empty');
ok(Object.keys(readState({ review: { v: 1, c: { c1: { s: 'bogus' }, c2: { s: 'review', q: ['x', 2, -1] } } } }).c).join() === 'c2' && readState({ review: { v: 1, c: { c2: { s: 'review', q: ['x', 2, -1] } } } }).c.c2.q.join() === '2', 'malformed entries from the browser are dropped, never trusted');

// one missed concept
let s = recordRun(readState(null), qs, run([[0, R], [1, W], [2, R]]), ids);
let list = reviewList(s, content);
ok(list.length === 1 && list[0].id === 'c2' && list[0].state === STATE.REVIEW && list[0].questions.join() === '1', 'one missed question → its concept is to review, with the question that showed it');
ok(list[0].topic === 'Cell division' && list[0].concept.refs.join() === '8', 'the concept comes with its topic and the lines that explain it (from the stored map, no AI)');

// multiple missed concepts, unanswered ignored
s = recordRun(readState(null), qs, { items: [{ qi: 0 }, { qi: 1 }, { qi: 2 }, { qi: 3 }], answers: [W, W, undefined] }, ids);
ok(openConcepts(reviewList(s, content)).map((x) => x.id).join() === 'c1,c2', 'several misses → several concepts, in the order taught; unanswered questions are no evidence');

// correct after retry clears; a miss in the same run keeps it open
s = recordRun(readState(null), qs, run([[1, W], [3, W]]), ids);
ok(s.c.c2.m === 2 && s.c.c2.q.join() === '1,3', 'two misses on one concept are counted on that concept');
let s2 = recordRun(s, qs, { kind: 'focus', ...run([[3, R]]) }, ids);
ok(s2.c.c2.s === STATE.CLEARED && s2.c.c2.ok === 1, 'a right answer after the miss clears the concept');
s2 = recordRun(s, qs, run([[3, R], [1, W]]), ids);
ok(s2.c.c2.s === STATE.REVIEW, 'right on one question but wrong on another in the same run → still to review');
ok(recordRun(readState(null), qs, run([[0, R]]), ids).c.c1 === undefined, 'a right answer with no earlier miss adds nothing');
// a "close" short answer and "My answer was right" are right
ok(recordRun(readState(null), qs, run([[2, { correct: true, verdict: 'close' }]]), ids).c.c3 === undefined, 'a close short answer counts as right');

// reviewed
s2 = markReviewed(s, 'c2');
ok(s2.c.c2.s === STATE.REVIEWED && openConcepts(reviewList(s2, content)).length === 1, '“Got it” marks it reviewed; it stays open until answered right');

// flagged (faulty / ambiguous) questions are not evidence
s2 = flagQuestion(recordRun(readState(null), qs, run([[0, W]]), ids), 0);
ok(!s2.c.c1 && s2.flag.includes(0), 'flagging the only missed question removes the concept: a faulty question is not a gap in understanding');
s2 = recordRun(s2, qs, run([[0, W]]), ids);
ok(!s2.c.c1, 'a flagged question keeps not counting in later runs');
s2 = flagQuestion(recordRun(readState(null), qs, run([[1, W], [3, W]]), ids), 1);
ok(s2.c.c2.s === STATE.REVIEW && s2.c.c2.q.join() === '3', 'flagging one of two misses keeps the concept, on the other evidence');

// a cautioned question (possibly misheard word) → "check", not a gap
s2 = recordRun(readState(null), qs, run([[4, W]]), ids);
ok(s2.c.c3.s === STATE.CHECK && openConcepts(reviewList(s2, content)).length === 0 && counts(reviewList(s2, content)).check === 1, 'missing a question with a transcription caution → “check the recording”, not counted as not knowing');
s2 = recordRun(s2, qs, run([[2, W]]), ids);
ok(s2.c.c3.s === STATE.REVIEW, '…a miss on a clean question about it does count');

// practice from stored questions first
s = recordRun(readState(null), qs, run([[1, W]]), ids);
ok(practiceItems(s, content, ['c2']).join() === '3,1', 'practice uses stored questions: not-yet-missed first, then the missed one');
ok(needsNewQuestions(s, content, ['c2']).length === 0 && needsNewQuestions(recordRun(s, qs, run([[3, W]]), ids), content, ['c2']).join() === 'c2', 'new questions are suggested only when every stored question on the concept was missed');
const withFollow = { ...content, followups: [{ concept: 'c2', type: 'multiple_choice', question: 'Follow-up on meiosis', answer: 'A', options: ['A', 'B', 'C', 'D'], followup: true }] };
ok(practiceItems(recordRun(s, qs, run([[3, W]]), ids), withFollow, ['c2'])[0] === 5, 'a follow-up question gets the next index (existing indexes never move) and is practised first');
ok(practiceItems(flagQuestion(s, 3), content, ['c2']).join() === '1', 'flagged questions are never used for practice');

// renames: the state holds ids only; names come from the content as shown now
s = recordRun(readState(null), qs, run([[1, W]]), ids);
ok(!JSON.stringify(s).includes('Speaker') && !JSON.stringify(s).includes('meiosis'), 'the saved state holds ids only (no names, no text)');
const renamedSegs = Array.from({ length: 13 }, (_, id) => ({ id, speaker: id === 8 ? 'Dr. Lee' : 'Speaker 1', text: 'x' }));
const shown = resolveContent(content, renamedSegs);
ok(reviewList(s, shown)[0].concept.summary.startsWith('Dr. Lee explained'), 'after a speaker rename the review shows the new name (resolved when shown)');

// regenerated quiz: unknown concept ids are ignored
ok(reviewList({ v: 1, c: { c99: { s: 'review', m: 1, ok: 0, q: [0], t: 1 } }, flag: [] }, content).length === 0, 'entries for concepts that no longer exist (new questions written) are ignored');

// size limit of progress (4000 bytes, shared with the score)
let big = readState(null);
for (let i = 0; i < 90; i++) big.c[`c${i}`] = { s: i % 3 ? STATE.REVIEW : STATE.CLEARED, m: 3, ok: 1, q: [1, 2, 3, 4], t: 1792111111 + i };
big = compact(big);
const saved = withState({ last_score: 12, total: 15, attempts: 3, completed_at: new Date().toISOString(), missed: [1, 2, 3, 4, 5, 6] }, big);
ok(Object.keys(big.c).length === 40 && new TextEncoder().encode(JSON.stringify(saved)).length < 4000, 'at most 40 concepts are kept, and score + review fit in the 4000-byte progress');
ok(Object.values(big.c).filter((e) => e.s === STATE.CLEARED).length < Object.values(big.c).filter((e) => e.s !== STATE.CLEARED).length, 'open concepts are kept before cleared ones');
ok(withState({ last_score: 3, total: 5 }, s).last_score === 3, 'saving the review keeps the quiz score');
console.log(`\n${pass} checks passed`);
