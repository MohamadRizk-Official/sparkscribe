// Runaway-repetition helpers (src/engine/loops.js): boundaries of the thresholds, token tails, and what is kept or cut.
import assert from 'node:assert/strict';
const L = await import(new URL('../src/engine/loops.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); pass++; console.log('ok -', m); };

// ---- thresholds: emphasis (2–4 repeats) is never a loop
ok(!L.isLoopRun(1, 7) && L.isLoopRun(1, 8), 'a single word is a loop from 8 repeats');
ok(!L.isLoopRun(2, 5) && L.isLoopRun(2, 6), 'a multi-word unit is a loop from 6 repeats');
ok(!L.isLoopRun(4, 5) && L.isLoopRun(4, 6), 'a longer unit uses the same 6-repeat threshold');
ok(!L.isLoopRun(0, 99), 'a unit of length 0 is never a loop');

// ---- tailRepetition on token lists
eq(L.tailRepetition([]), null, 'an empty list has no repetition');
eq(L.tailRepetition([5]), null, 'one token has no repetition');
eq(L.tailRepetition([1, 2, 3]), null, 'distinct tokens have no repetition');
eq(L.tailRepetition([7, 7]), { unit: 1, reps: 2, start: 0 }, 'two equal tokens are a run of 2');
eq(L.tailRepetition([9, 1, 2, 1, 2, 1, 2]), { unit: 2, reps: 3, start: 1 }, 'a repeated pair at the end is found, and where it begins');
eq(L.tailRepetition([1, 2, 1, 2, 3]), null, 'a repeat that does not reach the end is not a tail repetition');
const longest = L.tailRepetition([1, 1, 1, 1, 1, 1]);
ok(longest.reps * longest.unit === 6 && longest.start === 0, 'a run of one token wins over shorter-unit readings that cover less');

// ---- cutTextLoop
eq(L.cutTextLoop(''), null, 'empty text has nothing to cut');
eq(L.cutTextLoop('hello'), null, 'a single word has nothing to cut');
eq(L.cutTextLoop('no, no, no, no'), null, 'emphatic repetition is left alone');
eq(L.cutTextLoop('well so so so so so so so so'), { text: 'well', loop: { unit: 'so', repeats: 8, removedWords: 8 } }, 'a repeated single word is removed entirely');
const phrase = L.cutTextLoop('you know? I hope so. I hope so. I hope so. I hope so. I hope so. I hope so.');
ok(phrase.text === 'you know? I hope so.' && phrase.loop.repeats === 6, 'a repeated phrase keeps exactly one copy');
ok(phrase.loop.removedWords === 15, 'the report counts the removed words (5 copies of 3 words)');
eq(L.cutTextLoop('So, so, so, so, so, so, so, so').text, '', 'case and punctuation do not hide a loop, and a text that is only a loop becomes empty');
const forced = L.cutTextLoop('a b so so so', ['so']);
ok(forced.text === 'a b' && forced.loop.repeats === 3, 'when the decoder already stopped on a unit, a short run of it is cut too');

// ---- punctuation tidying
ok(L.tidy('a,, , ,b') === 'a,b', 'tidy collapses runs of commas, semicolons and colons');
ok(L.tidy('  fine.  ') === 'fine.', 'tidy trims and leaves ordinary text alone');
ok(L.tidy('wait... what?!') === 'wait... what?!', 'tidy leaves full stops, question and exclamation marks alone');
ok(L.tidyCut('you know?, ') === 'you know?', 'after a cut, punctuation left dangling after a sentence end goes');
ok(L.tidyCut('and then,') === 'and then', 'after a cut, a trailing comma goes');
ok(L.tidyCut('wait.,') === 'wait.', 'after a cut, "." followed by a comma keeps the full stop');

// ---- wordKeys
eq(L.wordKeys("Don't STOP, now!  "), ["don't", 'stop', 'now'], 'wordKeys lower-cases, keeps apostrophes and drops punctuation');
eq(L.wordKeys('... !!'), [], 'punctuation-only words disappear');
eq(L.wordKeys('Café déjà-vu'), ['café', 'déjàvu'], 'letters with accents are kept');

console.log(`\n${pass} checks passed`);
