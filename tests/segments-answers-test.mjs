// Answer classification in src/lib/segments.js: NOT_FOUND, isNotFound, isNegativeAnswer, refersToPlayback, isFollowUp
// (extra cases beyond service-test.mjs).
import assert from 'node:assert/strict';
const S = await import(new URL('../src/lib/segments.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

ok(S.isNotFound(S.NOT_FOUND), 'the NOT_FOUND sentence is recognised');
ok(S.isNotFound("  I couldn’t find that in this recording, sorry."), 'a curly apostrophe, leading space and trailing words still match');
ok(S.isNotFound("i couldn't find that in this recording"), 'matching is case-insensitive');
ok(!S.isNotFound('He said I couldn\'t find that in this recording'), 'the phrase must start the answer');
ok(!S.isNotFound(''), 'empty text is not a not-found answer');

ok(S.isNegativeAnswer(S.NOT_FOUND), 'a not-found answer is negative');
ok(S.isNegativeAnswer('No deadline was mentioned.'), '"No deadline was mentioned" is negative');
ok(S.isNegativeAnswer('Nothing was said about pricing.'), '"Nothing was said about…" is negative');
ok(!S.isNegativeAnswer('The deadline is Friday [3].'), 'a plain statement is not negative');
ok(!S.isNegativeAnswer(''), 'empty text is not negative');

ok(S.refersToPlayback('explain this part') && S.refersToPlayback('summarise that section'), '"this part" / "that section" refer to playback');
ok(S.refersToPlayback('what is said right now?') === true, '"right now" refers to playback');
ok(S.refersToPlayback('what happens right here') && S.refersToPlayback('what did she just say'), '"right here" and "just say" refer to playback');
ok(!S.refersToPlayback('summarise the whole recording'), 'a whole-recording question does not');

ok(S.isFollowUp('why') && S.isFollowUp('and then?'), 'one to three words is a follow-up');
ok(S.isFollowUp('what do you mean by that exactly'), 'a follow-up opener makes a long question a follow-up');
ok(!S.isFollowUp('When is the project deadline for the second phase'), 'a long standalone question is not');

console.log(`${pass} checks passed`);
