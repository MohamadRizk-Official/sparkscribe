// The same-voice check on the combined speaker result (src/engine/voice-guard.js): which stretches are fingerprinted,
// average voices, merging two names for one voice, and when the combined result is used at all.
//   node tests/voice-guard-test.mjs
import assert from 'node:assert/strict';
import { voiceSamples, centroidsOf, mergeSameVoices, peopleIn, useCombined, SAME_VOICE } from '../src/engine/voice-guard.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const S = (start, end, speaker) => ({ start, end, speaker });
const v = (...x) => { const n = Math.hypot(...x); return Float32Array.from(x.map((a) => a / n)); };

// 1. samples: the longest stretches of each person, the middle 4 s of long ones; Unknown and short bits skipped
{
  const segs = [S(0, 10, 'A'), S(10, 10.5, 'B'), S(11, 13, 'B'), S(13, 14, 'Unknown'), S(14, 16.5, 'A')];
  const s = voiceSamples(segs);
  ok(!s.has('Unknown'), 'Unknown stretches are never fingerprinted');
  ok(s.get('A').length === 2 && s.get('A')[0][0].start === 3 && s.get('A')[0][0].end === 7, 'a 10 s stretch is cut to its middle 4 s; longest first');
  ok(s.get('B').length === 1 && s.get('B')[0][0].start === 11, 'stretches under a second are skipped');
}

// 2. centroids: the average of a person's fingerprints, made unit length
{
  const samples = new Map([['A', [[S(0, 1)], [S(1, 2)]]], ['B', [[S(2, 3)]]]]);
  const c = centroidsOf(samples, [v(1, 0), v(0, 1), v(1, 1)]);
  ok(Math.abs(c.get('A')[0] - Math.SQRT1_2) < 1e-6 && Math.abs(c.get('A')[1] - Math.SQRT1_2) < 1e-6, 'two fingerprints average to their unit-length mean');
}

// 3. merging: two names for nearly the same voice become one (the one with more speech keeps the name)
{
  const segs = [S(0, 30, 'A'), S(30, 40, 'B'), S(40, 70, 'C')];
  const cent = new Map([['A', v(1, 0.05)], ['B', v(1, 0)], ['C', v(0, 1)]]);
  const g = mergeSameVoices(segs, cent, SAME_VOICE);
  ok(g.merged.length === 1 && g.merged[0].from === 'B' && g.merged[0].into === 'A', 'B (same voice as A, less speech) becomes A');
  ok(g.segments.length === 2 && g.segments[0].end === 40 && g.segments[1].speaker === 'C', 'the joined stretches are one; a different voice is untouched');
  const none = mergeSameVoices(segs, new Map([['A', v(1, 0)], ['C', v(0, 1)]]), SAME_VOICE);
  ok(none.merged.length === 0 && none.segments.length === 3, 'different voices are not merged; a person without a fingerprint is left alone');
}

// 4. when the combined result is used: at most four people talking 5 s or more, or a chosen count of two to four
{
  const four = [S(0, 6, 'A'), S(6, 12, 'B'), S(12, 18, 'C'), S(18, 24, 'D'), S(24, 26, 'E'), S(26, 40, 'Unknown')];
  ok(peopleIn(four) === 4, 'people who talk under 5 s and Unknown are not counted');
  ok(useCombined(four) && !useCombined([...four, S(40, 46, 'F')]), 'four people: combined; five: the first engine alone');
  ok(useCombined([], 3) && !useCombined(four, 5) && !useCombined(four, 1), 'a count chosen by the student decides (2 to 4)');
}

console.log(`\n${pass} passed`);
