// Word-onset head: per 20 ms frame of the word-timing model's hidden features (wav2vec2-base-960h layer 8, 768 values),
// a score for "a word starts here" (a logit). Trained on human word times (AMI meetings, accuracy/research
// speaker-2026-10-30 PROTOCOL.md addendum 4). Small: a 768 -> 96 projection, then two convolutions over time
// (9 frames, then 5); about 130k weights, a fraction of a second per paragraph on a processor. Used by
// lib/ctc-align.js refineStarts, in align-worker.js.
//
// Weights file (float16, little-endian, in this order): W1 [96 x 768] (input normalisation folded in), b1 [96],
// C1 [64 x 96 x 9], c1 [64], C2 [64 x 5], c2 [1].
export const HIDDEN = 768, P = 96, C = 64, K1 = 9, K2 = 5;
export const WEIGHT_COUNT = P * HIDDEN + P + C * P * K1 + C + C * K2 + 1;

export function halfToFloat(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}

// bytes: ArrayBuffer of WEIGHT_COUNT float16 values
export function loadOnsetHead(bytes) {
  const u = new Uint16Array(bytes);
  if (u.length !== WEIGHT_COUNT) throw new Error(`onset head: ${u.length} weights, expected ${WEIGHT_COUNT}`);
  const w = new Float32Array(WEIGHT_COUNT);
  for (let i = 0; i < u.length; i++) w[i] = halfToFloat(u[i]);
  let o = 0;
  const take = (n) => w.subarray(o, (o += n));
  return { W1: take(P * HIDDEN), b1: take(P), C1: take(C * P * K1), c1: take(C), C2: take(C * K2), c2: take(1) };
}

// exact GELU (as PyTorch's default), erf by Abramowitz & Stegun 7.1.26 (error below 1.5e-7)
function gelu(x) {
  const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * x * (1 + (x < 0 ? -erf : erf));
}

// hidden: [frames x 768] values (Float32Array, or Uint16Array of float16) -> Float32Array [frames] onset logits
export function onsetScores(head, hidden, frames) {
  const half = hidden instanceof Uint16Array;
  const x = new Float32Array(HIDDEN);
  const p = new Float32Array(frames * P); // projection, GELU
  for (let t = 0; t < frames; t++) {
    for (let j = 0; j < HIDDEN; j++) x[j] = half ? halfToFloat(hidden[t * HIDDEN + j]) : hidden[t * HIDDEN + j];
    for (let i = 0; i < P; i++) {
      let s = head.b1[i];
      const row = i * HIDDEN;
      for (let j = 0; j < HIDDEN; j++) s += head.W1[row + j] * x[j];
      p[t * P + i] = gelu(s);
    }
  }
  const h = new Float32Array(frames * C); // first convolution (zero padding), GELU
  const r1 = K1 >> 1;
  for (let t = 0; t < frames; t++) for (let c = 0; c < C; c++) {
    let s = head.c1[c];
    for (let k = 0; k < K1; k++) {
      const tt = t + k - r1;
      if (tt < 0 || tt >= frames) continue;
      for (let i = 0; i < P; i++) s += head.C1[(c * P + i) * K1 + k] * p[tt * P + i];
    }
    h[t * C + c] = gelu(s);
  }
  const out = new Float32Array(frames); // second convolution -> one logit per frame
  const r2 = K2 >> 1;
  for (let t = 0; t < frames; t++) {
    let s = head.c2[0];
    for (let k = 0; k < K2; k++) {
      const tt = t + k - r2;
      if (tt < 0 || tt >= frames) continue;
      for (let c = 0; c < C; c++) s += head.C2[c * K2 + k] * h[tt * C + c];
    }
    out[t] = s;
  }
  return out;
}
