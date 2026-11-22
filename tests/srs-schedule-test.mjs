// Flashcard spaced review (src/insights/srs.js) over a whole study history: the ladder is walked step by step,
// a lapse restarts it, and a full set stays inside the 4000-byte progress limit the module comment promises.
import assert from 'node:assert/strict';
const { INTERVALS, today, rate, readSrs, dueIndexes } = await import(new URL('../src/insights/srs.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const DAY = 86_400_000;

// ---- a card answered "good" on the day it comes due climbs the whole ladder
let srs = {};
let day = 200;
const gaps = [];
for (let step = 0; step < INTERVALS.length + 2; step++) {
  srs = rate(srs, 0, 'good', day * DAY);
  gaps.push(srs[0][0] - day);
  day = srs[0][0];
}
ok(gaps.slice(0, INTERVALS.length).join() === INTERVALS.join(), 'repeated "good" gives exactly the ladder 1, 3, 7, 16, 35, 80 days');
ok(gaps.slice(INTERVALS.length).every((g) => g === 80), 'after the top step the card stays at 80 days');

// ---- a card is due on its due day, not the day before
const due = rate({}, 3, 'good', 50 * DAY)[3][0];
ok(dueIndexes({ 3: [due, 0] }, 10, (due - 1) * DAY).length === 0, 'not due the day before');
ok(dueIndexes({ 3: [due, 0] }, 10, due * DAY).join() === '3', 'due on the day itself');
ok(dueIndexes({ 3: [due, 0] }, 10, (due + 30) * DAY).join() === '3', 'still due (overdue) a month later');

// ---- a lapse after progress restarts the ladder
let lapsed = rate(rate(rate({}, 1, 'good', 10 * DAY), 1, 'good', 10 * DAY), 1, 'good', 10 * DAY);
ok(lapsed[1][1] === 2, 'three "good" ratings reach step 2');
lapsed = rate(lapsed, 1, 'again', 20 * DAY);
ok(lapsed[1][1] === 0 && lapsed[1][0] === 20, '"again" goes back to step 0, due the same day');
ok(rate(lapsed, 1, 'good', 20 * DAY)[1][0] === 23, 'the next "good" after a lapse moves up one step: 3 days out');

// ---- the day boundary is UTC midnight
ok(today(DAY - 1) === 0 && today(DAY) === 1, 'the day number changes exactly at 00:00 UTC');

// ---- a set stays small enough for the progress column
let big = {};
for (let i = 0; i < 100; i++) big = rate(big, i, i % 2 ? 'easy' : 'good', 20_000 * DAY);
const bytes = JSON.stringify({ srs: big }).length;
ok(bytes < 4000, `100 rated cards use ${bytes} bytes of the 4000-byte limit`);
ok(Object.keys(readSrs({ srs: big })).length === 100, 'a stored set of 100 cards is read back whole');
ok(JSON.stringify(readSrs({ srs: big })) === JSON.stringify(big), 'reading a clean stored set changes nothing');

console.log(`\n${pass} checks passed`);
