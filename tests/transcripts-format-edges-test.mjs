// lib/transcripts.js display helpers and the .txt parser at their edges.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./vite-env-hook.mjs', import.meta.url);
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const T = await import(new URL('../src/lib/transcripts.js', import.meta.url).href);

let pass = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); pass++; console.log('ok -', m); };

eq(T.fmtDuration(null), '—', 'no duration shows a dash');
eq(T.fmtDuration(undefined), '—', 'undefined duration shows a dash');
eq(T.fmtDuration(0), '0:00', 'zero seconds');
eq(T.fmtDuration(-4), '0:00', 'negative seconds are zero');
eq(T.fmtDuration(59.6), '1:00', 'seconds are rounded');
eq(T.fmtDuration(754), '12:34', 'minutes and seconds');
eq(T.fmtDuration(3600), '1:00:00', 'an hour adds a zero-padded minutes field');
eq(T.fmtDuration(36000 + 61), '10:01:01', 'ten hours');
eq(T.langName(''), '', 'no language code gives an empty name');
eq(T.langName('en'), 'English', 'en is English');
eq(T.langName('fr'), 'French', 'fr is French');
eq(T.parseTranscriptText(''), [], 'empty text has no groups');
eq(T.parseTranscriptText(null), [], 'null has no groups');
eq(T.parseTranscriptText('no timestamps here\njust text'), [], 'text before the first speaker line is ignored');
eq(T.parseTranscriptText('[0:14] Speaker 1:\nHello\nthere\n\n[1:02:03] Maya Q.:\nBye'), [
  { time: '0:14', speaker: 'Speaker 1', text: 'Hello there' },
  { time: '1:02:03', speaker: 'Maya Q.', text: 'Bye' },
], 'lines of one turn are joined and h:mm:ss times are accepted');
eq(T.parseTranscriptText('[0:05] A:\r\nline one\r\n[0:09] B:\r\nline two'), [
  { time: '0:05', speaker: 'A', text: 'line one' },
  { time: '0:09', speaker: 'B', text: 'line two' },
], 'Windows line endings are handled');
eq(T.parseTranscriptText('[0:05] A:\n[0:09] B:\ntext'), [
  { time: '0:05', speaker: 'A', text: '' },
  { time: '0:09', speaker: 'B', text: 'text' },
], 'a turn with no text is kept with empty text');
eq(T.parseTranscriptText('[7] A:\ntext'), [], 'a time without a colon is not a speaker line');
console.log(`${pass} checks passed`);
