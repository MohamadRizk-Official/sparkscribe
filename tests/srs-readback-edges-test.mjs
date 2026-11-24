// insights/srs.js: reading a stored schedule defensively, and the rating steps at the ends of the ladder.
import assert from 'node:assert/strict';
import { INTERVALS, today, readSrs, rate, dueIndexes, nextLabel } from '../src/insights/srs.js';

let pass = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); pass++; console.log('ok -', m); };
const DAY = 86_400_000, NOW = Date.UTC(2026, 10, 24, 12);

eq(INTERVALS, [1, 3, 7, 16, 35, 80], 'the interval ladder');
eq(today(NOW), Math.floor(NOW / DAY), 'today is whole days since 1970 (UTC)');
eq(readSrs(null), {}, 'null progress reads as empty');
eq(readSrs({ srs: [1, 2] }), {}, 'an array is not a schedule');
eq(readSrs({ srs: 'x' }), {}, 'a string is not a schedule');
eq(readSrs({ srs: { 0: [10, 2], 1000: [10, 2], a: [10, 2], 2: [1.5, 2], 3: [10], 4: 'no' } }), { 0: [10, 2] }, 'only well-formed entries with a short numeric key are kept');
eq(readSrs({ srs: { 0: [10, 99], 1: [10, -4] } }), { 0: [10, 5], 1: [10, 0] }, 'a step outside the ladder is clamped');

eq(rate({}, 0, 'again', NOW), { 0: [today(NOW), 0] }, 'a first "again" is due today at step 0');
eq(rate({}, 0, 'good', NOW), { 0: [today(NOW) + 1, 0] }, 'a first "good" comes back tomorrow');
eq(rate({}, 0, 'easy', NOW), { 0: [today(NOW) + 3, 1] }, 'a first "easy" skips a step');
eq(rate({ 0: [1, 5] }, 0, 'good', NOW), { 0: [today(NOW) + 80, 5] }, 'the top of the ladder stays at 80 days');
eq(rate({ 0: [1, 4] }, 0, 'easy', NOW), { 0: [today(NOW) + 80, 5] }, 'easy never goes past the top');
eq(rate({ 0: [1, 4] }, 0, 'again', NOW), { 0: [today(NOW), 0] }, 'again resets any step to 0');
eq(rate({ 0: [1, 2] }, 0, 'whatever', NOW), { 0: [today(NOW) + 16, 3] }, 'an unknown rating counts as "good"');
const before = { 0: [1, 2] };
rate(before, 0, 'good', NOW);
eq(before, { 0: [1, 2] }, 'rate does not change its input');
eq(rate({ 1: [5, 1] }, 0, 'good', NOW)[1], [5, 1], 'rating one card leaves the others as they were');

const srs = { 0: [today(NOW), 0], 1: [today(NOW) - 5, 1], 2: [today(NOW) + 1, 0], 7: [today(NOW), 0] };
eq(dueIndexes(srs, 10, NOW), [0, 1, 7], 'cards due today or earlier, in index order');
eq(dueIndexes(srs, 3, NOW), [0, 1], 'cards beyond the set size are ignored');
eq(dueIndexes({}, 10, NOW), [], 'nothing rated means nothing due');
console.log(`${pass} checks passed`);
