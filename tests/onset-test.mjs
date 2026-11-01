// Sentence-click word starts (addendum 4 of accuracy/research/speaker-2026-10-30/PROTOCOL.md): the extra model output
// appended to an ONNX file (src/lib/onnx-output.js), the word-onset head's arithmetic (src/lib/onset-head.js), and moving
// word starts to the latest onset (src/lib/ctc-align.js refineStarts).
//   node tests/onset-test.mjs
import assert from 'node:assert/strict';
import { withExtraOutput, extraOutputBytes } from '../src/lib/onnx-output.js';
import { loadOnsetHead, onsetScores, halfToFloat, WEIGHT_COUNT, HIDDEN } from '../src/lib/onset-head.js';
import { refineStarts, ONSET_SETTINGS } from '../src/lib/ctc-align.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

// 1. the appended output: a second ModelProto.graph field holding one ValueInfoProto, added once
{
  const add = extraOutputBytes('h', 10);
  // graph (field 7, length-delimited) { output (field 12) { name (1) = "h", type (2) { tensor_type (1) { elem_type (1) = 10 } } } }
  ok(JSON.stringify([...add]) === JSON.stringify([58, 11, 98, 9, 10, 1, 104, 18, 4, 10, 2, 8, 10]), 'the appended bytes encode graph.output { name, float16 tensor type }');
  const model = Uint8Array.from([1, 2, 3]);
  const once = withExtraOutput(model, 'h', 10);
  ok(once.length === 3 + add.length && once[0] === 1 && once[3] === 58, 'the output is appended after the original bytes');
  ok(withExtraOutput(once, 'h', 10) === once, 'appending again leaves an already patched file unchanged');
}

// 2. the head: float16 weights, a projection, two convolutions; zero weights give the bias, a single path is traced
{
  const half = (x) => { // float32 -> float16 bits (normal numbers only, enough here)
    const f = new Float32Array([x]), u = new Uint32Array(f.buffer)[0];
    return ((u >>> 16) & 0x8000) | ((((u >>> 23) & 0xff) - 112) << 10) | ((u >>> 13) & 0x3ff);
  };
  ok(halfToFloat(half(1.5)) === 1.5 && halfToFloat(half(-0.25)) === -0.25 && halfToFloat(0) === 0, 'float16 decoding');
  const w = new Uint16Array(WEIGHT_COUNT);
  const head0 = loadOnsetHead(w.buffer);
  const zeros = onsetScores(head0, new Float32Array(3 * HIDDEN), 3);
  ok(zeros.every((v) => v === 0), 'all-zero weights score every frame 0');
  // c2 (the last weight) = 1: every frame scores 1
  w[WEIGHT_COUNT - 1] = half(1);
  ok(onsetScores(loadOnsetHead(w.buffer), new Float32Array(2 * HIDDEN), 2).every((v) => Math.abs(v - 1) < 1e-6), 'the output bias reaches every frame');
  assert.throws(() => loadOnsetHead(new Uint16Array(10).buffer), /expected/); pass++; console.log('ok - a weights file of the wrong size is refused');
}

// 3. refineStarts: the latest clear onset before the aligned first letter, never later, never before the previous word
{
  const score = new Float32Array(200).fill(-10); // one logit per 20 ms
  score[40] = 3; // an onset at 0.80 s (inside the previous word: before its last letter)
  score[55] = 2; // 1.10 s
  score[60] = 1; // 1.20 s: the latest clear onset before the word's aligned start
  const words = [{ w: 'so', s: 0.6, e: 1.0 }, { w: 'yes', s: 1.4, e: 1.8 }];
  const r = refineStarts(words, score, 0, ONSET_SETTINGS);
  ok(Math.abs(r[1].s - 1.2) < 1e-9, 'a late aligned start moves back to the latest onset (1.20 s, not the stronger 1.10 s)');
  ok(words[1].s === 1.4, 'the input words are not changed');
  ok(r[0].e === 1.0, 'word ends are kept');
  const quiet = refineStarts([{ w: 'yes', s: 1.4, e: 1.8 }], new Float32Array(200).fill(-10), 0, ONSET_SETTINGS);
  ok(quiet[0].s === 1.4, 'with no onset above the threshold the aligned start is kept');
  const later = new Float32Array(200).fill(-10); later[75] = 4; // 1.50 s, after the aligned start
  ok(refineStarts([{ w: 'yes', s: 1.4, e: 1.8 }], later, 0, ONSET_SETTINGS)[0].s === 1.4, 'a start is never moved later than aligned');
  const nulls = refineStarts([null, { w: 'a', s: 1.4, e: 1.6 }], score, 0, ONSET_SETTINGS);
  ok(nulls[0] === null && nulls[1].s === 1.2, 'untimed words (null) are passed through');
}

console.log(`\n${pass} passed`);
