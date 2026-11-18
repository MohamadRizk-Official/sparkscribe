// Focused Review's stored state (src/insights/focus-review.js): readState never trusts what it reads, compact keeps the
// state small by dropping cleared concepts first, and flagQuestion / markReviewed leave their input untouched.
//   node tests/focus-review-state-test.mjs
import assert from 'node:assert/strict';
import { REVIEW_VERSION, STATE, readState, compact, counts, openConcepts, markReviewed, flagQuestion, withState } from '../src/insights/focus-review.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

// ---- readState
const empty = readState(undefined);
ok(empty.v === REVIEW_VERSION && Object.keys(empty.c).length === 0 && empty.flag.length === 0, 'no progress: a clean empty state');
ok(Object.keys(readState({ review: 'junk' }).c).length === 0, 'a review value that is not an object is ignored');
ok(Object.keys(readState({ review: { v: 99, c: { a: { s: 'review', q: [1] } } } }).c).length === 0, 'state from another version is ignored');
const read = readState({ review: { v: REVIEW_VERSION, c: {
  good: { s: 'review', m: 2.9, ok: -3, q: [0, 2, -1, 1.5, 'x', 3, 4, 5, 6] },
  bad: { s: 'mastered', m: 1, q: [] },
  nul: null,
} } });
ok(Object.keys(read.c).join() === 'good', 'entries with an unknown state or no body are dropped');
ok(read.c.good.m === 2 && read.c.good.ok === 0, 'counters are whole numbers, never negative');
ok(read.c.good.q.join() === '0,2,3,4', 'question indexes keep only non-negative whole numbers, at most four');
const longId = 'x'.repeat(50);
ok(Object.keys(readState({ review: { v: REVIEW_VERSION, c: { [longId]: { s: 'check' } } } }).c)[0].length === 20, 'a concept id is cut to 20 characters');

// ---- compact
const entry = (s, t) => ({ s, m: 1, ok: 0, q: [], t });
const big = { v: REVIEW_VERSION, flag: [], c: {} };
for (let i = 0; i < 30; i++) big.c['k' + i] = entry(STATE.CLEARED, 1000 + i);
for (let i = 0; i < 30; i++) big.c['r' + i] = entry(STATE.REVIEW, i);
const small = compact(big);
const kept = Object.keys(small.c);
ok(kept.length === 40, 'a state over 40 concepts is cut to 40');
ok(kept.filter((k) => k.startsWith('r')).length === 30, 'concepts still to review are all kept');
ok(kept.filter((k) => k.startsWith('k')).length === 10 && kept.includes('k29') && !kept.includes('k0'), 'the newest cleared concepts fill the rest; the oldest cleared ones go');
const tiny = { v: REVIEW_VERSION, flag: [], c: { a: entry(STATE.REVIEW, 1) } };
ok(compact(tiny) === tiny, 'a small state is returned as it is');

// ---- markReviewed / flagQuestion do not mutate
const st = { v: REVIEW_VERSION, flag: [], c: { a: { s: STATE.REVIEW, m: 1, ok: 0, q: [3], t: 5 }, b: { s: STATE.CLEARED, m: 1, ok: 1, q: [3], t: 5 } } };
const snap = JSON.stringify(st);
const rev = markReviewed(st, 'a');
ok(rev.c.a.s === STATE.REVIEWED && JSON.stringify(st) === snap, 'markReviewed moves a concept to reviewed and leaves the old state alone');
ok(markReviewed(st, 'b').c.b.s === STATE.CLEARED && markReviewed(st, 'zzz').c.zzz === undefined, 'only a concept still to review can be marked reviewed');
const fl = flagQuestion(st, 3);
ok(fl.flag.join() === '3' && !('a' in fl.c) && fl.c.b.s === STATE.CLEARED, 'flagging a question removes a concept whose only miss it was, but keeps a cleared one');
ok(JSON.stringify(st) === snap, 'flagQuestion leaves the old state alone');
ok(flagQuestion(fl, 3).flag.join() === '3', 'flagging the same question twice lists it once');

// ---- counts / openConcepts / withState
const list = [{ state: STATE.REVIEW }, { state: STATE.REVIEWED }, { state: STATE.CLEARED }, { state: STATE.CHECK }, { state: STATE.REVIEW }];
ok(JSON.stringify(counts(list)) === '{"review":2,"reviewed":1,"cleared":1,"check":1}', 'counts tallies concepts in each state');
ok(openConcepts(list).length === 3, 'open concepts are those to review or reviewed but not yet answered right');
ok(withState({ score: 4 }, empty).score === 4 && withState(null, empty).review === empty, 'withState puts the review next to the rest of the quiz progress');
console.log(`\n${pass} checks passed`);
