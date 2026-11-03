// Same voice, two names: a check on the combined speaker result (combine.js) for the second speaker model's known
// failure, inventing a person by splitting one voice in two (accuracy/research/speaker-2026-10-30/PROTOCOL.md,
// addendum 3: it failed on one- and two-person recordings). Every named person's voice is fingerprinted from a few of
// their clearest stretches with the first engine's own voice model (WeSpeaker, engine/diarize.js embedClips), and two
// people whose average voices are nearly the same are made one. Nothing else is changed.
//
//   voiceSamples(segments) -> Map(speaker -> [[{ start, end }], …]) the stretches to fingerprint, longest first
//   centroidsOf(samples, embeddings) -> Map(speaker -> unit vector) (embeddings: one unit vector per stretch, in order)
//   mergeSameVoices(segments, centroids, threshold) -> { segments, merged: [{ from, into, similarity }] }
export const SAMPLE_MIN_S = 1.0; // a stretch shorter than this says little about a voice
export const SAMPLE_MAX_S = 4.0; // longer stretches are cut to this
export const SAMPLES_PER_SPEAKER = 8;

const speakerTime = (segments) => {
  const t = new Map();
  for (const s of segments) t.set(s.speaker, (t.get(s.speaker) || 0) + (s.end - s.start));
  return t;
};

export function voiceSamples(segments, { minS = SAMPLE_MIN_S, maxS = SAMPLE_MAX_S, perSpeaker = SAMPLES_PER_SPEAKER, unknown = 'Unknown' } = {}) {
  const by = new Map();
  for (const s of segments) {
    if (s.speaker === unknown || s.end - s.start < minS) continue;
    if (!by.has(s.speaker)) by.set(s.speaker, []);
    by.get(s.speaker).push(s);
  }
  const out = new Map();
  for (const [spk, list] of by) {
    const pick = [...list].sort((a, b) => b.end - b.start - (a.end - a.start)).slice(0, perSpeaker);
    // the middle of a long stretch: its edges are where another voice ends or begins
    out.set(spk, pick.map((s) => { const d = s.end - s.start, cut = Math.max(0, (d - maxS) / 2); return [{ start: s.start + cut, end: s.end - cut }]; }));
  }
  return out;
}

export function centroidsOf(samples, embeddings) {
  const out = new Map();
  let k = 0;
  for (const [spk, list] of samples) {
    const vs = list.map(() => embeddings[k++]).filter(Boolean);
    if (!vs.length) continue;
    const c = new Float32Array(vs[0].length);
    for (const v of vs) for (let i = 0; i < c.length; i++) c[i] += v[i];
    out.set(spk, unit(c));
  }
  return out;
}

function unit(v) {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}
const cos = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// Most similar pair first; after a merge the joined voice is the speech-weighted mean of the two, and the pairs are
// compared again. The person with more speech keeps the name. Speakers without a fingerprint are left as they are.
export function mergeSameVoices(segments, centroids, threshold) {
  const time = speakerTime(segments);
  const groups = new Map([...centroids].map(([s, c]) => [s, { c, t: time.get(s) || 0, members: [s] }]));
  const merged = [];
  for (;;) {
    let best = null;
    const keys = [...groups.keys()];
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const v = cos(groups.get(keys[i]).c, groups.get(keys[j]).c);
      if (v >= threshold && (!best || v > best.v)) best = { a: keys[i], b: keys[j], v };
    }
    if (!best) break;
    const A = groups.get(best.a), B = groups.get(best.b);
    const [keep, drop, K, Dg] = A.t >= B.t ? [best.a, best.b, A, B] : [best.b, best.a, B, A];
    const c = K.c.map((x, i) => x * K.t + Dg.c[i] * Dg.t);
    groups.set(keep, { c: unit(c), t: K.t + Dg.t, members: [...K.members, ...Dg.members] });
    groups.delete(drop);
    merged.push({ from: drop, into: keep, similarity: +best.v.toFixed(3) });
  }
  const rename = new Map();
  for (const [keep, g] of groups) for (const m of g.members) rename.set(m, keep);
  const out = [];
  for (const s of [...segments].sort((a, b) => a.start - b.start)) {
    const sp = rename.get(s.speaker) ?? s.speaker;
    const last = out[out.length - 1];
    if (last && last.speaker === sp && s.start - last.end < 1e-6) last.end = Math.max(last.end, s.end);
    else out.push({ ...s, speaker: sp });
  }
  return { segments: out, merged };
}

// Chosen on development data only (VoxConverse dev 216 + test 232, AMI dev 6; PROTOCOL.md addendum 5): people whose
// voices are this alike are one person, and the combined result is used only while it names at most four people
// (each talking 5 s or more) after that, or when the student chose two to four; otherwise the first engine's result is
// kept as it is.
export const SAME_VOICE = 0.6;
export const MAX_PEOPLE = 4;
export const MIN_TALK_S = 5;

export function peopleIn(segments, unknown = 'Unknown') {
  return [...speakerTime(segments)].filter(([s, t]) => s !== unknown && t >= MIN_TALK_S).length;
}
export function useCombined(guarded, chosen = 0, unknown = 'Unknown') {
  if (chosen) return chosen >= 2 && chosen <= MAX_PEOPLE;
  return peopleIn(guarded, unknown) <= MAX_PEOPLE;
}
