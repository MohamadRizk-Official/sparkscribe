// Where playback should start when someone clicks a sentence, a paragraph or a reference (Summary, Notes, Ask, Create).
//
// A transcript paragraph is one piece of audio cut by the engine (16–27.5 s at most) and holds several sentences, but
// only the paragraph has a start time. Its start is where the cut fell, which is sometimes mid-word (a cut that
// couldn't land on a pause; the first second after it was transcribed at the end of the paragraph before).
//
// So each recording keeps a small loudness envelope (20 values a second, one byte each: ~70 KB per hour), made from
// the same decoded audio as the transcript, stored with the audio on this device and never uploaded. From it:
//   * breaths: moments clearly quieter than the speaker's own level around them (a relative dip, so they are found
//     over background noise and room sound too), or real silence;
//   * each sentence's start: the paragraph's speaking time is shared out by text length, which says roughly where each
//     sentence begins, and every sentence boundary is matched (in order) to a breath near that point;
//   * playback then starts in that breath, up to LEAD_S before the words, so the first word is never clipped.

import { alignWords } from './align-words.js';

export const ENV_HZ = 20;
export const LEAD_S = 0.5; // up to this much of the breath before the words (never before the breath began)
const DIP_DB = 9; // a breath: at least this much quieter than the speaker's level around it
const LOCAL_S = 1.5; // "around it": this far either side
const SPLIT_SHIFT_S = 0.8; // a cut through speech: the paragraph's own words start about this much later

// samples (Float32Array, mono) -> Uint8Array, one value per 1/ENV_HZ s: loudness in dB, 0 = silence, 255 = +12 dBFS
// (`scale` turns integer samples into -1…1: 1 / 32768 for 16-bit)
export function envelopeFromSamples(samples, sampleRate = 16000, scale = 1) {
  const frame = Math.max(1, Math.round(sampleRate / ENV_HZ));
  const n = Math.floor(samples.length / frame);
  const env = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * frame, end = j + frame; j < end; j++) sum += samples[j] * samples[j];
    const db = 10 * Math.log10((sum * scale * scale) / frame + 1e-12);
    env[i] = Math.max(0, Math.min(255, Math.round((db + 90) * 2.5)));
  }
  return env;
}

// ---------- breaths ----------
// One pass per recording (cached): which frames are a breath, and the breaths as runs [{ s, e, len }] in seconds
// (s = breath start, e = where speech resumes). Under ~6 dB between quiet and speech overall: none (constant noise).
const cache = new WeakMap();
function breaths(env, dipDb = DIP_DB) {
  let per = cache.get(env);
  if (!per) cache.set(env, (per = new Map()));
  if (per.has(dipDb)) return per.get(dipDb);
  const n = env.length;
  const sorted = Uint8Array.from(env).sort();
  const at = (p) => sorted[Math.min(n - 1, Math.floor(n * p))] || 0;
  const floor = at(0.05), speech = at(0.6), span = speech - floor;
  const out = { ok: span >= 15, mask: new Uint8Array(n), runs: [] };
  if (out.ok) {
    const quiet = floor + span * 0.4, silent = floor + span * 0.15, dip = dipDb * 2.5;
    // the speaker's level around each frame: the 80th percentile of a sliding window (a 256-bin histogram)
    const W = Math.round(LOCAL_S * ENV_HZ), hist = new Uint32Array(256);
    let count = 0;
    const add = (v, d) => { hist[v] += d; count += d; };
    for (let i = 0; i < Math.min(n, W); i++) add(env[i], 1);
    const deep = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (i + W < n) add(env[i + W], 1);
      if (i - W - 1 >= 0) add(env[i - W - 1], -1);
      let need = Math.ceil(count * 0.8), v = 0, c = 0;
      for (; v < 256; v++) { c += hist[v]; if (c >= need) break; }
      out.mask[i] = env[i] < quiet || env[i] < v - dip ? 1 : 0;
      deep[i] = env[i] < silent ? 1 : 0;
    }
    for (let i = 0; i < n; i++) {
      if (!out.mask[i]) continue;
      let j = i, d = deep[i];
      while (j + 1 < n && out.mask[j + 1]) { j++; d |= deep[j]; }
      if (j - i + 1 >= 2 || d) out.runs.push({ s: i / ENV_HZ, e: (j + 1) / ENV_HZ, len: (j - i + 1) / ENV_HZ }); // a breath is ≥ 0.1 s, or real silence
      i = j;
    }
  }
  per.set(dipDb, out);
  return out;
}

// start a little before the words: up to LEAD_S of the breath, never before the breath began
const leadIn = (p, lead = LEAD_S) => Math.max(p.s + 0.03, p.e - lead);

// runs ending (speech resuming) between t0 and t1
function runsEndingIn(B, t0, t1) {
  const out = [];
  for (const r of B.runs) { if (r.e < t0) continue; if (r.e > t1) break; out.push(r); }
  return out;
}

// The breath just before `target` (where words are expected to start) -> the time to start from. Ending slightly
// early is preferred to ending late (that would skip words), and never further back than `back` seconds.
export function breathBefore(env, target, { lead, back = 0.7, fwd = 0.5, dipDb, miss = 0.15 } = {}) {
  const B = env?.length ? breaths(env, dipDb) : null;
  if (!B?.ok) return Math.max(0, target - miss);
  let best = null, bestCost = Infinity;
  for (const r of runsEndingIn(B, target - back, target + fwd)) {
    const cost = r.e <= target ? target - r.e : 2.5 * (r.e - target);
    if (cost < bestCost) { bestCost = cost; best = r; }
  }
  return Math.max(0, best ? leadIn(best, lead) : target - miss);
}

const loudAt = (B, t) => {
  const i = Math.round(t * ENV_HZ);
  return B.ok && i > 0 && i < B.mask.length && !B.mask[i] && !B.mask[i - 1];
};

// Where to start playing paragraph `i` of `segs` ([{start, end, speaker}]).
export function paragraphStart(segs, i, env, o = {}) {
  const s = segs[i];
  if (!s) return 0;
  const B = env?.length ? breaths(env, o.dipDb) : null;
  if (!B?.ok) return Math.max(0, s.start - 0.1);
  const prev = segs[i - 1];
  // cut through speech (same voice, no gap, loud right at the cut): the shared second was shown above
  const split = prev && prev.speaker === s.speaker && Math.abs(prev.end - s.start) < 0.05 && loudAt(B, s.start);
  const target = split ? Math.min(s.start + SPLIT_SHIFT_S, (s.start + s.end) / 2) : s.start;
  return breathBefore(env, target, o);
}

// ---------- sentences inside a paragraph ----------
// sentences of a line of text -> [{ text, at }] (`at` = character offset); the transcript shows the same split
const SENTENCE_RE = /[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g;
const ABBREV = /(?:^|\s)(?:mr|mrs|ms|dr|prof|st|vs|etc|e\.g|i\.e|[a-z])\.\s*$/i;
export function splitSentences(text) {
  const out = [];
  for (const m of String(text || '').matchAll(SENTENCE_RE)) {
    if (!m[0].trim()) continue;
    // "Mr." / "e.g." / "3.5" / a lone initial: not the end of a sentence, keep it with what follows
    if (out.length && (ABBREV.test(out.at(-1).text) || (/\d[.]\s*$/.test(out.at(-1).text) && /^\d/.test(m[0])))) { out.at(-1).text += m[0]; continue; }
    out.push({ text: m[0], at: m.index });
  }
  return out.length ? out : [{ text: String(text || ''), at: 0 }];
}

// how long a piece of text takes to say, in arbitrary units (letters, plus a little per word)
const weight = (t) => (String(t).match(/[\p{L}\p{N}]/gu) || []).length + 1.5 * (String(t).match(/[\p{L}\p{N}]+/gu) || []).length;

// Where to start playing each sentence of paragraph `i` -> [seconds, …] (one per splitSentences(text))
export function sentenceStarts(segs, i, env, o = {}) {
  const s = segs[i];
  if (!s) return [];
  const parts = splitSentences(o.text ?? s.text); // the text as shown (clean view or as said)
  const first = paragraphStart(segs, i, env, o);
  if (parts.length === 1) return [first];
  const total = parts.reduce((t, p) => t + weight(p.text), 0) || 1;
  const fracs = [];
  let acc = 0;
  for (let k = 0; k < parts.length - 1; k++) { acc += weight(parts[k].text); fracs.push(acc / total); }
  const B = env?.length ? breaths(env, o.dipDb) : null;
  const a0 = Math.max(s.start, first + 0.05);
  if (!B?.ok) {
    // no envelope: share the paragraph's time out by text length, with a short lead-in
    const dur = Math.max(0.1, s.end - a0);
    return [first, ...fracs.map((f) => Math.max(a0, a0 + f * dur - 0.3))];
  }
  const a = Math.round(a0 * ENV_HZ), b = Math.min(B.mask.length, Math.round(s.end * ENV_HZ));
  if (b - a < 4) return parts.map(() => first);
  // speaking time from the paragraph's start: cum[f] = voiced frames before frame a+f
  const cum = new Float32Array(b - a + 1);
  for (let f = a; f < b; f++) cum[f - a + 1] = cum[f - a] + (B.mask[f] ? 0 : 1);
  const voiced = cum[b - a] || 1;
  const voicedAt = (t) => cum[Math.max(0, Math.min(b - a, Math.round(t * ENV_HZ) - a))];
  const timeAtVoiced = (v) => { let f = 0; while (f < b - a && cum[f] < v) f++; return (a + f) / ENV_HZ; };
  // candidate breaths inside the paragraph (not its first moments: that is the paragraph's own start)
  const P = runsEndingIn(B, (a + 3) / ENV_HZ, (b - 1) / ENV_HZ);
  const sigma = Math.max(o.sigmaMin ?? 0.7, (o.sigmaFrac ?? 0.06) * voiced / ENV_HZ); // seconds of speaking time
  const beta = o.beta ?? 1.2, none = o.none ?? 2;
  const K = fracs.length;
  const want = fracs.map((f) => Math.max(0, f * voiced - (o.bias ?? 0) * ENV_HZ)); // speaking frames before sentence k+1 starts
  const costOf = (k, p) => { const d = (voicedAt(p.e) - want[k]) / ENV_HZ / sigma; return d * d - beta * Math.log(1 + p.len / 0.1); };
  // the K boundaries matched to breaths in order (each breath used once, a boundary may have none): least total cost
  const INF = 1e9;
  let prev = new Float64Array(P.length + 1).fill(INF); // state j+1 = breath j was the last one used; 0 = none yet
  prev[0] = 0;
  const steps = [];
  for (let k = 0; k < K; k++) {
    const cur = new Float64Array(P.length + 1).fill(INF);
    const from = new Int32Array(P.length + 1), pick = new Int32Array(P.length + 1).fill(-1);
    for (let st = 0; st <= P.length; st++) {
      if (prev[st] >= INF) continue;
      if (prev[st] + none < cur[st]) { cur[st] = prev[st] + none; from[st] = st; pick[st] = -1; }
      for (let j = st; j < P.length; j++) {
        const c = prev[st] + costOf(k, P[j]);
        if (c < cur[j + 1]) { cur[j + 1] = c; from[j + 1] = st; pick[j + 1] = j; }
      }
    }
    steps.push({ from, pick });
    prev = cur;
  }
  let st = 0;
  for (let j = 1; j <= P.length; j++) if (prev[j] < prev[st]) st = j;
  const out = new Array(K);
  for (let k = K - 1; k >= 0; k--) {
    const j = steps[k].pick[st];
    out[k] = j >= 0 ? leadIn(P[j], o.lead) : Math.max(a0, timeAtVoiced(want[k]) - 0.3);
    st = steps[k].from[st];
  }
  return [first, ...out];
}

// The paragraph a time belongs to (a reference's seconds are a paragraph's start)
export function paragraphIndexAt(segs, t) {
  let idx = -1;
  for (let k = 0; k < segs.length; k++) { if (segs[k].start <= t + 0.05) idx = k; else break; }
  return idx;
}

// ---------- sentences with timed words (the aligner: src/align-worker.js, lib/sentence-timing.js) ----------
// `words` = [[word, start, end], …] in seconds for this paragraph. Each sentence's first word is found in them (texts
// are matched like a spelling diff), and playback starts in the breath before it, never before the previous word
// ended. The aligner's word starts run ~0.15 s late (measured against a larger model), hence TIMING_BIAS.
// Measured on 3 real meetings (220 sentences, two never used for tuning): 80 % of sentence clicks start in the gap
// before the sentence without clipping it, against 64 % from the envelope alone and 40 % before any of this.
const TIMING_BIAS = 0.15;
export function sentenceStartsTimed(segs, i, env, words, o = {}) {
  const s = segs[i];
  if (!s) return [];
  const text = o.text ?? s.text;
  const parts = splitSentences(text);
  const fallback = sentenceStarts(segs, i, env, { ...o, text });
  if (!words?.length || parts.length === 1) return fallback;
  const timed = words.map(([w, st, e]) => ({ w, s: st, e }));
  const tw = parts.flatMap((p) => p.text.trim().split(/\s+/).filter(Boolean));
  const map = alignWords(tw, timed);
  const out = [fallback[0]];
  let w = parts[0].text.trim().split(/\s+/).filter(Boolean).length;
  for (let k = 1; k < parts.length; k++) {
    const n = parts[k].text.trim().split(/\s+/).filter(Boolean).length;
    let j = w;
    while (j < w + n && map[j] < 0) j++;
    if (j >= w + n) { out.push(fallback[k]); w += n; continue; }
    const onset = timed[map[j]].s - TIMING_BIAS - (j - w) * 0.25;
    // the previous word's end (word ends from this model run long, so at most a short word after its start)
    const pw = timed[map[j] - 1];
    const floor = pw ? Math.min(pw.e, pw.s + 0.3) - TIMING_BIAS - 0.05 : -Infinity;
    const st = breathBefore(env, onset, { back: 0.5, fwd: 0, miss: 0.35, lead: o.lead });
    out.push(Math.max(0, Math.min(Math.max(st, floor), onset - 0.05)));
    w += n;
  }
  return out;
}
