// Ground-truth readers for the accuracy lab (accuracy/lab/reference.mjs): readRttm, toSeconds, readSpans.
import assert from 'node:assert/strict';
const R = await import(new URL('../accuracy/lab/reference.mjs', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

// ---- toSeconds ----
ok(R.toSeconds(12.5) === 12.5, 'a number is already seconds');
ok(R.toSeconds('0:05') === 5, 'm:ss reads as seconds');
ok(R.toSeconds('1:02.5') === 62.5, 'm:ss.s keeps the fraction');
ok(R.toSeconds('1:01:01') === 3661, 'h:mm:ss reads as hours, minutes, seconds');
ok(R.toSeconds('7') === 7, 'a plain string number is seconds');

// ---- readRttm ----
const rttm = [
  'SPEAKER rec1 1 0.50 2.25 <NA> <NA> alice <NA> <NA>',
  'SPEAKER rec1 1 3.00 1.00 <NA> <NA> bob <NA> <NA>',
  '',
  'SPKR-INFO rec1 1 <NA> <NA> <NA> unknown alice <NA> <NA>',
].join('\n');
const segs = R.readRttm(rttm);
ok(segs.length === 2, 'only SPEAKER lines become segments');
ok(segs[0].start === 0.5 && segs[0].end === 2.75 && segs[0].label === 'alice', 'end is start plus duration');
ok(segs[1].start === 3 && segs[1].end === 4 && segs[1].label === 'bob', 'each line keeps its own speaker label');
ok(R.readRttm('').length === 0, 'an empty file has no segments');
ok(R.readRttm('  SPEAKER x').length === 0, 'an indented line is not a SPEAKER line');
const crlf = R.readRttm('SPEAKER r 1 1.0 1.0 <NA> <NA> s1 <NA> <NA>\r\n');
ok(crlf.length === 1 && crlf[0].label === 's1', 'Windows line endings are tolerated');

// ---- readSpans ----
const spans = R.readSpans({ version: 1, numbering: 'by-appearance', spans: [['0:10', '0:20.5', 2], ['1:00', '1:05', 1, 'noisy']] });
ok(spans.length === 2, 'every span is read');
ok(spans[0].start === 10 && spans[0].end === 20.5 && spans[0].label === 2, 'times become seconds and the speaker number is the label');
ok(spans[0].note === null && spans[1].note === 'noisy', 'a missing note is null, a given note is kept');
ok(R.readSpans({}).length === 0, 'no spans key gives an empty list');
ok(R.readSpans({ spans: [[5, 6, 1]] })[0].start === 5, 'numeric times pass through');

console.log(`${pass} checks passed`);
