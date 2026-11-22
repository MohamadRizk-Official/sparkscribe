// nemotronDiarize (src/engine/nemotron.js) with stand-in ONNX sessions: turns per-frame speaker logits into
// {start, end, speaker} segments (sigmoid > 0.5 per 10 ms frame, up to 8 speakers, overlap allowed, no smoothing).
import assert from 'node:assert/strict';
const { nemotronDiarize } = await import(new URL('../src/engine/nemotron.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

const NMEL = 128, NBIN = 257, H = 512, K = 8, SUB = 8;
const mel = new Float32Array(NMEL * NBIN);
const silence = new Float32Array(H);
class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }
const ort = { Tensor };

// `on(frame, speaker)` says whether that speaker's logit is positive on that 10 ms frame (first chunk: no cache yet)
function sessions(on, seconds) {
  const frames = Math.floor((seconds * 16000) / 160);
  const T = Math.ceil(frames / SUB);
  const calls = { embed: 0, step: 0, shapes: [] };
  return {
    calls,
    embed: { run: async ({ features }) => { calls.embed++; calls.shapes.push(features.dims.join('x')); return { embeds: new Tensor('float32', new Float32Array(T * H), [1, T, H]) }; } },
    step: { run: async ({ embeds }) => {
      calls.step++;
      const rows = embeds.dims[1], lg = new Float32Array(rows * SUB * K);
      for (let f = 0; f < rows * SUB; f++) for (let k = 0; k < K; k++) lg[f * K + k] = on(f, k) ? 4 : -4;
      return { logits: new Tensor('float32', lg, [1, rows * SUB, K]) };
    } },
  };
}
const run = (on, seconds, extra = {}) => { const s = sessions(on, seconds); return nemotronDiarize(new Float32Array(seconds * 16000), { ort, mel, silence, ...s, ...extra }).then((segs) => ({ segs, calls: s.calls })); };

// ---- one speaker, one stretch
let r = await run((f, k) => k === 0 && f >= 100 && f < 200, 5);
ok(r.segs.length === 1 && r.segs[0].speaker === 'S0' && r.segs[0].start === 1 && r.segs[0].end === 2, 'frames 100–199 of speaker 0 become one segment 1.00–2.00 s');
ok(r.calls.embed === 1 && r.calls.step === 1, 'a short recording needs one embedding call and one step call');
ok(r.calls.shapes[0] === `1x${5 * 100}x${NMEL}`, 'the features reach the model as [1, frames, 128] (100 frames per second)');

// ---- overlapping speakers give overlapping segments, sorted by start time
r = await run((f, k) => (k === 0 && f >= 100 && f < 200) || (k === 1 && f >= 150 && f < 250), 5);
ok(r.segs.length === 2, 'two speakers give two segments');
ok(r.segs[0].speaker === 'S0' && r.segs[1].speaker === 'S1' && r.segs[0].start === 1 && r.segs[1].start === 1.5, 'segments are sorted by start time');
ok(r.segs[0].end > r.segs[1].start, 'overlapping speech is kept as overlapping segments');

// ---- gaps split a speaker's turns; same start sorts by speaker label
r = await run((f, k) => (k === 2 && ((f >= 50 && f < 80) || (f >= 120 && f < 150))) || (k === 1 && f >= 50 && f < 60), 5);
ok(r.segs.filter((s) => s.speaker === 'S2').length === 2, 'a silence between two stretches gives two segments');
ok(r.segs[0].speaker === 'S1' && r.segs[1].speaker === 'S2' && r.segs[0].start === r.segs[1].start, 'segments that start together are ordered by speaker label');

// ---- nobody speaking, and a speaker on through the very last frame
r = await run(() => false, 3);
ok(r.segs.length === 0, 'no positive logits give no segments');
r = await run((f, k) => k === 7 && f >= 250, 3);
ok(r.segs.length === 1 && r.segs[0].speaker === 'S7' && r.segs[0].end === 3, 'speaker 7 still talking at the end closes at the end of the audio');

// ---- progress is reported
const seen = [];
await run((f, k) => k === 0, 4, { onProgress: (a, b) => seen.push([a, b]) });
ok(seen.length === 1 && seen[0][0] === seen[0][1], 'progress is reported once for a short recording, ending at the total');

console.log(`\n${pass} checks passed`);
