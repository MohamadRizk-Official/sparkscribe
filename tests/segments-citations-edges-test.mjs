// lib/segments.js: citation parsing and the small question/answer classifiers, on awkward inputs.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./vite-env-hook.mjs', import.meta.url);
const S = await import(new URL('../src/lib/segments.js', import.meta.url).href);

let pass = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); pass++; console.log('ok -', m); };

eq(S.normalizeRecordingType('lecture'), 'lecture', 'a known recording type is kept');
eq(S.normalizeRecordingType('webinar'), 'general', 'an unknown type becomes general');
eq(S.normalizeRecordingType(undefined), 'general', 'undefined becomes general');
eq(S.citedIds('Seen in [3], [3, 5] and [5][8].'), [3, 5, 8], 'cited ids are distinct and in order of appearance');
eq(S.citedIds('No citations, [x] or [].'), [], 'brackets without numbers are not citations');
eq(S.citedIds('[ 4 ,  9 ]'), [], 'spaces just inside the brackets are not accepted');
eq(S.citedIds('[4 ,  9]'), [4, 9], 'spaces around a comma are accepted');
eq(S.splitCitations('A [1, 99] B', (n) => n < 50), [{ text: 'A ' }, { refs: [1] }, { text: ' B' }], 'a mixed group keeps only its valid ids');
eq(S.splitCitations('plain', () => true), [{ text: 'plain' }], 'text without citations is one part');
eq(S.splitCitations('', () => true), [], 'empty text gives no parts');
eq(S.parseClock('1:02:03'), 3723, 'h:mm:ss parses to seconds');
eq(S.parseClock('14:05'), 845, 'm:ss parses to seconds');
eq(S.parseClock('abc'), 0, 'garbage parses to zero');
eq(S.fmtClock(-3), '0:00', 'a negative time shows 0:00');
eq(S.fmtClock(3599.9), '59:59', 'fractions are floored');
eq(S.fmtClock(undefined), '0:00', 'undefined shows 0:00');
eq(S.toStoredSegments([{ speaker: 's1', start: 1.234, end: 2.999, text: 'hi' }], () => 'Maya', () => 'Speaker 1'), [{ s: 1.23, e: 3, sp: 'Maya', t: 'hi', o: 'Speaker 1' }], 'times are rounded to 2 decimals and a renamed speaker keeps its original label');
eq(S.toStoredSegments([{ speaker: 's1', start: 0, end: 1, text: 'hi' }], () => 'Speaker 1', () => 'Speaker 1'), [{ s: 0, e: 1, sp: 'Speaker 1', t: 'hi' }], 'an unchanged speaker has no original label');
eq(S.isNotFound("  I couldn't find that in this recording."), true, 'the not-found sentence is recognised with leading spaces');
eq(S.isNotFound('I couldn’t find that in this recording'), true, 'a typographic apostrophe is recognised too');
eq(S.isNegativeAnswer('No deadline was mentioned.'), true, 'an answer saying nothing was mentioned is negative');
eq(S.isNegativeAnswer('The deadline is Friday.'), false, 'a positive answer is not negative');
eq(S.refersToPlayback('Explain this part'), true, '"this part" refers to playback');
eq(S.refersToPlayback('What is mitosis?'), false, 'a plain question does not');
eq(S.isFollowUp('Why?'), true, 'a very short question is a follow-up');
eq(S.isFollowUp('What about shipping costs for Europe'), true, '"what about" starts a follow-up');
eq(S.isFollowUp('Summarise the main argument of the second lecture'), false, 'a full standalone question is not a follow-up');
console.log(`${pass} checks passed`);
