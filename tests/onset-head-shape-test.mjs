// Word-onset head (src/lib/onset-head.js): float16 decoding, the weight-file size check and the output shape.
import assert from 'node:assert/strict';
const { halfToFloat, loadOnsetHead, onsetScores, WEIGHT_COUNT, HIDDEN, P, C, K1, K2 } = await import(new URL('../src/lib/onset-head.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const throws = (f, re, m) => { assert.throws(f, re, m); pass++; console.log('ok -', m); };

// ---- float16 decoding (IEEE 754 half precision)
ok(halfToFloat(0x0000) === 0, 'zero');
ok(halfToFloat(0x3c00) === 1, '0x3c00 is 1');
ok(halfToFloat(0xbc00) === -1, '0xbc00 is -1');
ok(halfToFloat(0x4000) === 2, '0x4000 is 2');
ok(halfToFloat(0x3800) === 0.5, '0x3800 is 0.5');
ok(halfToFloat(0x7bff) === 65504, 'the largest half value is 65504');
ok(halfToFloat(0x0001) === 2 ** -24, 'the smallest subnormal is 2^-24');
ok(halfToFloat(0x7c00) === Infinity && halfToFloat(0xfc00) === -Infinity, 'exponent 31 with no fraction is ±Infinity');
ok(Number.isNaN(halfToFloat(0x7e00)), 'exponent 31 with a fraction is NaN');
ok(Object.is(halfToFloat(0x8000), -0) || halfToFloat(0x8000) === 0, 'negative zero reads as zero');

// ---- the weight file
ok(WEIGHT_COUNT === P * HIDDEN + P + C * P * K1 + C + C * K2 + 1, 'WEIGHT_COUNT is the sum of the six tensors');
ok(WEIGHT_COUNT > 100_000 && WEIGHT_COUNT < 200_000, `about 130k weights (${WEIGHT_COUNT})`);
throws(() => loadOnsetHead(new ArrayBuffer(10)), /expected/, 'a file of the wrong size is refused with the expected count in the message');
throws(() => loadOnsetHead(new Uint16Array(WEIGHT_COUNT + 1).buffer), /weights/, 'one weight too many is refused');

const head = loadOnsetHead(new Uint16Array(WEIGHT_COUNT).buffer);
ok(head.W1.length === P * HIDDEN && head.b1.length === P && head.C1.length === C * P * K1 && head.c1.length === C && head.C2.length === C * K2 && head.c2.length === 1,
  'the tensors are split in the documented sizes');

// ---- one logit per frame; all-zero weights give the (zero) output bias at every frame
const frames = 7;
const out = onsetScores(head, new Float32Array(frames * HIDDEN).fill(0.3), frames);
ok(out instanceof Float32Array && out.length === frames, 'one score per frame');
ok(out.every((v) => v === 0), 'all-zero weights give a zero score everywhere');
ok(onsetScores(head, new Float32Array(0), 0).length === 0, 'no frames gives no scores');

// ---- float16 input gives the same scores as float32 input
const h = new Uint16Array(WEIGHT_COUNT);
h[WEIGHT_COUNT - 1] = 0x3c00; // c2 = 1: the final bias is 1
const biased = loadOnsetHead(h.buffer);
const f32 = onsetScores(biased, new Float32Array(frames * HIDDEN), frames);
const f16 = onsetScores(biased, new Uint16Array(frames * HIDDEN), frames);
ok(f32.every((v) => v === 1) && f16.every((v) => v === 1), 'with only the final bias set every frame scores exactly that bias, for float32 and float16 input');

console.log(`\n${pass} checks passed`);
