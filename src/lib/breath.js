// Where playback should start when someone clicks a paragraph or a reference (Summary, Notes, Ask, Create).
//
// A transcript paragraph is one piece of audio cut by the engine (16–27.5 s at most), so its start time is where the
// cut fell, not where a sentence begins: a cut that couldn't land on a pause is mid-word, and the first second after
// it was transcribed at the end of the paragraph before (the two pieces share that audio and the repeated words are
// removed from the second). Starting exactly there sounds clipped, or replays words shown above.
//
// So each recording keeps a small loudness envelope (20 values a second, one byte each: ~70 KB per hour), made from
// the same decoded audio as the transcript, stored with the audio on this device and never uploaded. A seek then
// starts in the breath just before the words: the nearest pause around the paragraph's start, preferring one that
// comes slightly early over one that skips words.

export const ENV_HZ = 20;
const LEAD_S = 0.12; // start this far into the pause, so the first syllable isn't clipped
const BACK_S = 1.6; // how far back a pause may be (the words before it belong to the paragraph above)
const FWD_S = 0.5; // how far ahead
const SPLIT_SHIFT_S = 0.8; // a cut through speech: the paragraph's own words start about this much later

// samples (Float32Array, mono) -> Uint8Array, one value per 1/ENV_HZ s: loudness in dB, 0 = silence, 255 = +12 dBFS
export function envelopeFromSamples(samples, sampleRate = 16000) {
  const frame = Math.max(1, Math.round(sampleRate / ENV_HZ));
  const n = Math.floor(samples.length / frame);
  const env = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * frame, end = j + frame; j < end; j++) sum += samples[j] * samples[j];
    const db = 10 * Math.log10(sum / frame + 1e-12);
    env[i] = Math.max(0, Math.min(255, Math.round((db + 90) * 2.5)));
  }
  return env;
}

// For audio kept before envelopes existed: decode it at a low rate (only short files: decoding is all in memory).
export async function envelopeFromBlob(blob, { maxBytes = 40e6 } = {}) {
  if (!blob || blob.size > maxBytes || typeof OfflineAudioContext === 'undefined') return null;
  try {
    const bytes = await blob.arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, 8000); // decodeAudioData resamples to the context's rate
    const buf = await ctx.decodeAudioData(bytes);
    const ch = buf.numberOfChannels;
    let mono = buf.getChannelData(0);
    if (ch > 1) {
      mono = Float32Array.from(mono);
      for (let c = 1; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < mono.length; i++) mono[i] += d[i]; }
      for (let i = 0; i < mono.length; i++) mono[i] /= ch;
    }
    return envelopeFromSamples(mono, buf.sampleRate);
  } catch { return null; }
}

// quiet / speech levels of one recording, measured once
const levelsCache = new WeakMap();
function levels(env) {
  let lv = levelsCache.get(env);
  if (lv) return lv;
  const sorted = Uint8Array.from(env).sort();
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
  const floor = at(0.05), speech = at(0.6);
  const span = speech - floor;
  // under ~6 dB between the quiet and the speech: no pauses to find (constant noise, music)
  lv = span < 15 ? { quiet: -1, silent: -1 } : { quiet: floor + span * 0.4, silent: floor + span * 0.15 };
  levelsCache.set(env, lv);
  return lv;
}

// The pause nearest `target` (preferring one just before it) -> the time to start from.
export function breathBefore(env, target) {
  if (!env?.length) return Math.max(0, target - 0.15);
  const { quiet, silent } = levels(env);
  const from = Math.max(0, Math.floor((target - BACK_S) * ENV_HZ));
  const to = Math.min(env.length - 1, Math.ceil((target + FWD_S) * ENV_HZ));
  let best = null, bestCost = Infinity;
  for (let i = from; i <= to; i++) {
    if (env[i] >= quiet) continue;
    let j = i, deep = env[i] < silent;
    while (j + 1 < env.length && env[j + 1] < quiet) { j++; if (env[j] < silent) deep = true; }
    if (j - i + 1 >= 2 || deep) { // a breath is at least 0.1 s, unless it is real silence
      const onset = (j + 1) / ENV_HZ; // where speech resumes
      if (onset >= target - BACK_S) {
        const cost = onset <= target ? target - onset : 2.5 * (onset - target); // skipping words is worse
        if (cost < bestCost) { bestCost = cost; best = Math.max(i / ENV_HZ, onset - LEAD_S); }
      }
    }
    i = j;
  }
  return Math.max(0, best ?? target - 0.25);
}

const loudAt = (env, t) => {
  const i = Math.round(t * ENV_HZ), { quiet } = levels(env);
  return quiet > 0 && i >= 0 && i < env.length && env[i] >= quiet && env[Math.max(0, i - 1)] >= quiet;
};

// Where to start playing paragraph `i` of `segs` ([{start, end, speaker}]).
export function paragraphStart(segs, i, env) {
  const s = segs[i];
  if (!s) return 0;
  if (!env?.length) return Math.max(0, s.start - 0.1);
  const prev = segs[i - 1];
  // cut through speech (same voice, no gap, loud right at the cut): the shared second was shown above
  const split = prev && prev.speaker === s.speaker && Math.abs(prev.end - s.start) < 0.05 && loudAt(env, s.start);
  const target = split ? Math.min(s.start + SPLIT_SHIFT_S, (s.start + s.end) / 2) : s.start;
  return breathBefore(env, target);
}

// The paragraph a time belongs to (a reference's seconds are a paragraph's start)
export function paragraphIndexAt(segs, t) {
  let idx = -1;
  for (let k = 0; k < segs.length; k++) { if (segs[k].start <= t + 0.05) idx = k; else break; }
  return idx;
}
