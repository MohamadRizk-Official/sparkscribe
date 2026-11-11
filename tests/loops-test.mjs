// Runaway-repetition detection (src/engine/loops.js): thresholds, tail runs, text cutting, punctuation tidying.
import assert from 'node:assert/strict';
const L = await import(new URL('../src/engine/loops.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

// ---- thresholds ----
ok(L.LOOP_SINGLE_REPS === 8 && L.LOOP_UNIT_REPS === 6, 'thresholds: 8 single repeats, 6 repeats of a longer unit');
ok(L.isLoopRun(1, 8) && !L.isLoopRun(1, 7), 'a single token is a loop from 8 repeats');
ok(L.isLoopRun(2, 6) && L.isLoopRun(4, 6) && !L.isLoopRun(3, 5), 'a longer unit is a loop from 6 repeats');
ok(!L.isLoopRun(1, 4) && !L.isLoopRun(2, 4), 'ordinary emphasis (2-4 repeats) is not a loop');

// ---- tailRepetition ----
let t = L.tailRepetition(['a', 'b', 'a', 'b', 'a', 'b']);
ok(t.unit === 2 && t.reps === 3 && t.start === 0, 'finds a repeated 2-token unit at the end');
ok(L.tailRepetition(['x', 'y', 'z']) === null, 'no repetition gives null');
t = L.tailRepetition([9, 1, 1, 1, 1]);
ok(t.unit === 1 && t.reps === 4 && t.start === 1, 'start is where the run begins');
ok(L.tailRepetition([]) === null && L.tailRepetition(['a']) === null, 'too-short lists give null');
ok(L.tailRepetition(['a', 'a']).reps === 2, 'two equal tokens are a run of 2');
ok(L.tailRepetition(['a', 'b', 'c', 'a', 'b', 'c']).unit === 3, 'a repeated 3-token unit is found');

// ---- wordKeys ----
ok(L.wordKeys("Hello, World! don't").join('|') === "hello|world|don't", 'wordKeys lowercases and strips punctuation but keeps apostrophes');
ok(L.wordKeys('  ...  ?! ').length === 0, 'punctuation-only text has no word keys');

// ---- cutTextLoop ----
let r = L.cutTextLoop('you know? so so so so so so so so so');
ok(r.text === 'you know?' && r.loop.unit === 'so' && r.loop.repeats === 9, 'a repeated single word is removed entirely');
r = L.cutTextLoop('I hope so. I hope so. I hope so. I hope so. I hope so. I hope so.');
ok(r.text === 'I hope so.' && r.loop.unit === 'i hope so' && r.loop.repeats === 6, 'a repeated phrase keeps one copy');
ok(r.loop.removedWords === 15, 'removedWords counts the words dropped');
ok(L.cutTextLoop('no, no, no, it is fine') === null, 'emphasis is not cut');
ok(L.cutTextLoop('so so so so so so so') === null, '7 repeats of one word is below the threshold');
ok(L.cutTextLoop('') === null, 'empty text has nothing to cut');
r = L.cutTextLoop('fine so so', ['so']);
ok(r.text === 'fine' && r.loop.repeats === 2, 'when the decoder already stopped on a unit, even a short run is cut');
ok(L.cutTextLoop('hello there', ['so']) === null, 'a given unit that does not end the text cuts nothing');

// ---- tidy ----
ok(L.tidy('a,,,, b') === 'a, b', 'tidy collapses runs of punctuation debris');
ok(L.tidy('  a; ,b ') === 'a;b', 'tidy trims and merges mixed separators');
ok(L.tidy('plain text.') === 'plain text.', 'tidy leaves normal text alone');
ok(L.tidyCut('you know?, ') === 'you know?', 'tidyCut removes dangling punctuation after a cut');
ok(L.tidyCut('well, ok') === 'well, ok', 'tidyCut keeps ordinary commas');

console.log(`${pass} checks passed`);
