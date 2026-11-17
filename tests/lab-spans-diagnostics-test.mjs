// Accuracy-lab scoring of partial human labels and frame diagnostics: scoreSpans (accuracy/lab/extras.mjs),
// frames, hypRunsOf and summary (accuracy/lab/diagnostics.mjs).
import assert from 'node:assert/strict';
const X = await import(new URL('../accuracy/lab/extras.mjs', import.meta.url).href);
const D = await import(new URL('../accuracy/lab/diagnostics.mjs', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const sp = (start, end, speaker, extra = {}) => ({ start, end, speaker, ...extra });

// ---- frames ----
ok(D.FR === 0.01, 'frames are 10 ms');
const f = D.frames([sp(0, 0.05, 'A'), sp(0.03, 0.08, 'B'), sp(0.05, 0.08, 'x', { overlap: true })], 0.1);
ok(f.nF === 10 && f.hypFrames.length === 10, 'the frame count covers the duration');
ok(f.hypFrames[0].has('A') && f.hypFrames[3].has('A') && f.hypFrames[3].has('B'), 'a frame holds every speaker talking in it');
ok(f.hypFrames[6].has('OVERLAP') && !f.hypFrames[6].has('x'), 'an overlap segment adds OVERLAP, not its own label');
ok(f.hypFrames[9].size === 0, 'frames after the last segment are empty');
ok(D.frames([sp(0, 99, 'A')], 0.05).hypFrames.length === 5, 'segments past the end are cut off at the duration');

// ---- hypRunsOf ----
let runs = D.hypRunsOf([sp(0, 1, 'A'), sp(1.2, 2, 'A'), sp(2, 3, 'B')]);
ok(runs.length === 2 && runs[0].end === 2 && runs[1].speaker === 'B', 'consecutive segments of one speaker with a short gap form one run');
runs = D.hypRunsOf([sp(0, 1, 'A'), sp(2, 3, 'A')]);
ok(runs.length === 2, 'a gap of half a second or more splits a run');
runs = D.hypRunsOf([sp(5, 6, 'B'), sp(0, 1, 'A')]);
ok(runs[0].speaker === 'A', 'segments are sorted by start before joining');
ok(D.hypRunsOf([]).length === 0, 'no segments, no runs');

// ---- summary ----
const sum = D.summary([sp(0, 1, 'A'), sp(1, 3, 'B'), sp(3, 4, 'Unknown'), sp(4, 5, 'x', { overlap: true })], 5, 'Unknown');
ok(sum.detectedSpeakers === 2, 'Unknown and overlap are not counted as detected speakers');
ok(sum.speakerTime.A === 1 && sum.speakerTime.B === 2, 'speaking time is measured per speaker');
ok(sum.unknownS === 1, 'unknown time is reported separately');

// ---- scoreSpans ----
const spans = [
  { start: 0, end: 10, label: 1 },
  { start: 10, end: 20, label: 2 },
  { start: 20, end: 30, label: 1 },
];
const hyp = [sp(0, 10, 'Hadi'), sp(10, 20, 'Sara'), sp(20, 30, 'Hadi')];
let s = X.scoreSpans(hyp, spans);
ok(s.spans === 3 && s.right === 3 && s.wrong === 0 && s.unsure === 0, 'a matching hypothesis gets every span right, whatever the speakers are called');
ok(s.mapping.Hadi === '1' && s.mapping.Sara === '2', 'the speaker-to-number mapping is reported');
ok(s.detail.length === 3 && s.detail[1].expected === '2' && s.detail[1].got === '2' && s.detail[1].verdict === 'right', 'each span has a detail row');
s = X.scoreSpans([sp(0, 10, 'Hadi'), sp(10, 20, 'Sara'), sp(20, 30, 'Sara')], spans);
ok(s.right === 2 && s.wrong === 1, 'a span given to the wrong speaker is wrong');
s = X.scoreSpans([sp(0, 10, 'Hadi'), sp(10, 20, 'Sara'), sp(20, 30, 'Unknown')], spans);
ok(s.right === 2 && s.unsure === 1 && s.detail[2].got === null, 'an Unknown stretch is unsure, not wrong');
s = X.scoreSpans([sp(0, 10, 'Hadi'), sp(10, 20, 'Sara'), sp(20, 30, 'x', { overlap: true })], spans);
ok(s.unsure === 1, 'an overlap stretch is unsure');
s = X.scoreSpans([sp(0, 10, 'Hadi')], []);
ok(s.spans === 0 && s.right === 0, 'no spans scores nothing');

console.log(`${pass} checks passed`);
