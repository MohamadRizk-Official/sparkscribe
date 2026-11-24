// lib/seek.js quietPoint at its limits: windows too short, clamping to the samples, 16-bit scale, ties and window edges.
import assert from 'node:assert/strict';
import { quietPoint } from '../src/lib/seek.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const rate = 1000; // hop = 10 samples = 10 ms

const tone = new Float32Array(rate * 2).fill(0.5);
ok(quietPoint(tone, rate, 0, 0.02) === null, 'a window of fewer than 3 steps (30 ms) gives null');
ok(quietPoint(tone, rate, 0, 0.03) !== null, 'a window of exactly 3 steps is enough');
ok(quietPoint(new Float32Array(0), rate, 0, 1) === null, 'no samples give null');
ok(quietPoint(tone, rate, 5, 6) === null, 'a window entirely after the samples gives null');
ok(quietPoint(tone, rate, 0.5, 0.4) === null, 'a reversed window gives null');

// a gap from 0.800 to 0.900 s in otherwise constant loudness
const gap = new Float32Array(rate * 2).fill(0.5);
for (let i = 800; i < 900; i++) gap[i] = 0;
const p = quietPoint(gap, rate, 0, 2);
ok(p >= 0.8 && p <= 0.9, 'the quietest point lies inside the gap');
ok(near(quietPoint(gap, rate, 0, 2), 0.815), 'it is the first of equally quiet steps (the earliest wins a tie)');
ok(quietPoint(gap, rate, 0.9, 2) > 0.9, 'a window starting after the gap cannot return a time inside it');
ok(quietPoint(gap, rate, -3, 2) === quietPoint(gap, rate, 0, 2), 'a negative start is clamped to the start of the samples');
ok(quietPoint(gap, rate, 0, 99) === quietPoint(gap, rate, 0, 2), 'an end past the samples is clamped to their end');

// 16-bit samples are brought to the same scale with `scale`
const loud16 = new Int16Array(rate * 2).fill(16384);
for (let i = 1200; i < 1300; i++) loud16[i] = 0;
const q16 = quietPoint(loud16, rate, 0, 2, 1 / 32768);
ok(q16 >= 1.2 && q16 <= 1.3, 'with a scale, 16-bit samples find the gap as float samples do');
ok(near(quietPoint(loud16, rate, 0, 2, 1 / 32768), quietPoint(loud16, rate, 0, 2)), 'the scale does not change where the minimum is');

ok(near(quietPoint(tone, rate, 0, 1), 0.015), 'with perfectly even loudness the first usable step is chosen (the middle of step 1)');
const edge = new Float32Array(rate).fill(0.5);
for (let i = 0; i < 10; i++) edge[i] = 0; // quiet only in the very first step
ok(near(quietPoint(edge, rate, 0, 1), 0.015), 'a quiet first step is reported through step 1: the first and last steps are never returned themselves');
console.log(`${pass} checks passed`);
