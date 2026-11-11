// Spaced review for flashcards (src/insights/srs.js): interval ladder, rating rules, due cards, stored-shape cleaning.
import assert from 'node:assert/strict';
const { INTERVALS, today, readSrs, rate, dueIndexes, nextLabel } = await import(new URL('../src/insights/srs.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const DAY = 86_400_000;
const now = 100 * DAY + 5000; // an arbitrary moment inside day 100

ok(INTERVALS.join(',') === '1,3,7,16,35,80', 'interval ladder is 1, 3, 7, 16, 35, 80 days');
ok(today(now) === 100, 'today() is whole days since 1970-01-01 UTC');
ok(today(0) === 0, 'today(0) is day 0');

// ---- rate ----
let s = rate({}, 4, 'good', now);
ok(s[4][1] === 0 && s[4][0] === 101, 'first "good" on a new card: step 0, due in 1 day');
s = rate(s, 4, 'good', now);
ok(s[4][1] === 1 && s[4][0] === 103, 'second "good": step 1, due in 3 days');
ok(rate({}, 1, 'easy', now)[1][1] === 1, 'first "easy" skips ahead to step 1');
ok(rate({ 2: [100, 3] }, 2, 'easy', now)[2][1] === 5, '"easy" moves two steps');
ok(rate({ 2: [100, 5] }, 2, 'good', now)[2][1] === 5, 'step is capped at the last interval');
ok(rate({ 2: [100, 5] }, 2, 'easy', now)[2][0] === 100 + 80, 'capped card is due in 80 days');
const again = rate({ 2: [150, 4] }, 2, 'again', now);
ok(again[2][0] === 100 && again[2][1] === 0, '"again" resets to step 0 and is due today');

const before = { 0: [100, 2] };
const frozen = JSON.stringify(before);
rate(before, 0, 'good', now);
ok(JSON.stringify(before) === frozen, 'rate() does not change its input');
ok(rate({ 7: [1, 1] }, 0, 'good', now)[7][0] === 1, 'rating one card leaves the others alone');

// ---- dueIndexes ----
const srs = { 0: [99, 1], 1: [100, 0], 2: [101, 0], 5: [50, 2], 12: [10, 0] };
ok(dueIndexes(srs, 6, now).join() === '0,1,5', 'due = rated cards with dueDay <= today, sorted, within the set');
ok(dueIndexes(srs, 20, now).join() === '0,1,5,12', 'a larger set includes index 12');
ok(dueIndexes({}, 10, now).length === 0, 'never-rated cards are not due');
ok(dueIndexes({ 3: [100, 0] }, 3, now).length === 0, 'a stale index beyond the card count is ignored');

// ---- readSrs ----
ok(Object.keys(readSrs(null)).length === 0, 'readSrs(null) is empty');
ok(Object.keys(readSrs({})).length === 0, 'readSrs without srs is empty');
ok(Object.keys(readSrs({ srs: [[1, 1]] })).length === 0, 'an array is not a valid srs object');
ok(Object.keys(readSrs({ srs: 'x' })).length === 0, 'a string is not a valid srs object');
const cleaned = readSrs({ srs: { 3: [10, 2], abc: [1, 1], 1234: [1, 1], 4: [1.5, 1], 5: [1], 6: 'no', 7: [10, 99], 8: [10, -4] } });
ok(Object.keys(cleaned).sort().join() === '3,7,8', 'invalid keys and values are dropped');
ok(cleaned[7][1] === 5 && cleaned[8][1] === 0, 'step is clamped into the ladder');

// ---- nextLabel ----
ok(nextLabel({}, 0, 'again') === 'again today', 'label for "again"');
ok(nextLabel({}, 0, 'good') === 'tomorrow', 'label for a first "good"');
ok(/^in \d+ days$/.test(nextLabel({ 0: [0, 1] }, 0, 'good')), 'label for a longer interval is "in N days"');

console.log(`${pass} checks passed`);
