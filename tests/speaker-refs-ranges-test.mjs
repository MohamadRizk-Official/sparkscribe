// Line ranges and the speaker table (src/lib/speaker-refs.js: toRanges, fromRanges, speakerTable, dominantSpeaker) at their edges.
import assert from 'node:assert/strict';
const R = await import(new URL('../src/lib/speaker-refs.js', import.meta.url).href);

let pass = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); pass++; console.log('ok -', m); };

// ---- toRanges
eq(R.toRanges([]), [], 'no lines, no ranges');
eq(R.toRanges([7]), [[7, 7]], 'one line is a range of one');
eq(R.toRanges([3, 1, 2]), [[1, 3]], 'unsorted lines are sorted first');
eq(R.toRanges([1, 1, 2, 2, 2]), [[1, 2]], 'repeated lines count once');
eq(R.toRanges([1, 2, 4, 5, 7]), [[1, 2], [4, 5], [7, 7]], 'a gap of one line starts a new range');
eq(R.toRanges([0, 1]), [[0, 1]], 'line 0 is a real line');
eq(R.toRanges([10, 2, 3]), [[2, 3], [10, 10]], 'numbers sort as numbers, not as text (10 after 3)');

// ---- fromRanges
eq(R.fromRanges([]), [], 'no ranges, no lines');
eq(R.fromRanges(null), [], 'null is no lines');
eq(R.fromRanges(undefined), [], 'undefined is no lines');
eq(R.fromRanges([[1, 3], [9, 9]]), [1, 2, 3, 9], 'ranges expand in order');
eq(R.fromRanges([5, [7, 8]]), [5, 7, 8], 'a bare number is a single line');
eq(R.fromRanges([['2', '4']]), [2, 3, 4], 'numbers stored as text are read as numbers');
eq(R.fromRanges([[4, 2]]), [], 'a backwards range is empty');
eq(R.fromRanges([[0, 100000000]]).length, 100000, 'a huge range is capped at 100000 lines');
for (const ids of [[1, 2, 3, 10, 11, 40], [0], [5, 6], [2, 4, 6]]) eq(R.fromRanges(R.toRanges(ids)), ids, `ranges round-trip for ${JSON.stringify(ids)}`);

// ---- dominantSpeaker
eq(R.dominantSpeaker({ S1: 0.8, S2: 0.2 }), 'S1', 'exactly 80% counts as dominant');
eq(R.dominantSpeaker({ S1: 0.79, S2: 0.21 }), null, 'just under 80% does not');
eq(R.dominantSpeaker({ S1: 0.5, S2: 0.5 }), null, 'an even split has no dominant speaker');
eq(R.dominantSpeaker({ S1: 0.1, S2: 0.9 }), 'S2', 'the code with the biggest share wins, whatever its position');
eq(R.dominantSpeaker({ S1: 0.6, S2: 0.4 }, 0.5), 'S1', 'the threshold can be changed');
eq(R.dominantSpeaker({}), null, 'nobody speaking gives null');
eq(R.dominantSpeaker(null), null, 'no shares gives null');
eq(R.dominantSpeaker(undefined), null, 'undefined shares gives null');

// ---- speakerTable
const seg = (id, speaker, text) => ({ id, speaker, text });
const t = R.speakerTable([seg(0, 'Dr. Lee', 'one two three'), seg(1, 'Sam', 'four'), seg(2, 'Dr. Lee', 'five six'), seg(3, 'Unknown', 'seven eight'), seg(4, 'Dr. Lee', 'nine')]);
eq(Object.keys(t.table), ['S1', 'S2'], 'codes follow the order speakers first speak, and Unknown gets none');
eq(t.table.S1, { name: 'Dr. Lee', lines: [[0, 0], [2, 2], [4, 4]] }, 'a speaker keeps the lines they said as ranges');
eq(t.table.S2, { name: 'Sam', lines: [[1, 1]] }, 'a second speaker is S2');
eq([...t.codeOf], [['Dr. Lee', 'S1'], ['Sam', 'S2']], 'codeOf maps each name to its code');
eq(Math.round(t.shares.S1 * 100), 67, 'shares count words over everyone, Unknown included (6 of 9)');
eq(Math.round(t.shares.S2 * 100), 11, '…so a quiet speaker has a small share');
const none = R.speakerTable([]);
eq([Object.keys(none.table), none.codeOf.size, none.shares], [[], 0, {}], 'no segments gives an empty table');
eq(Object.keys(R.speakerTable(null).table), [], 'null segments give an empty table');
const blank = R.speakerTable([seg(0, '', 'a b'), seg(1, undefined, 'c')]);
eq(Object.keys(blank.table), [], 'a missing or empty speaker name counts as Unknown');
const adjacent = R.speakerTable([seg(0, 'A', 'x'), seg(1, 'A', 'y'), seg(2, 'A', 'z')]);
eq(adjacent.table.S1.lines, [[0, 2]], 'consecutive lines by one speaker collapse into one range');
eq(R.speakerTable([seg(0, 'A', ''), seg(1, 'B', '')]).shares, { S1: 0, S2: 0 }, 'silent text gives zero shares, not NaN');

console.log(`\n${pass} checks passed`);
