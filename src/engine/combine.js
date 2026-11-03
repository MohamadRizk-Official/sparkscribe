// Two speaker-detection results combined into one ("who spoke when"), measured to be more accurate than either
// alone (accuracy/README.md, 2026-10-30): the PRIMARY (Nemotron-3-Diarization) is trusted where it names exactly one
// person; where it names nobody or two people at once, the SECONDARY (the pyannote + WeSpeaker engine,
// engine/diarize.js) decides, its labels translated into the primary's. A primary speaker the secondary consistently
// divides into two or more people was two people merged by the primary (it happens with a quiet fourth voice): inside
// it, the secondary's division is used.
//
// Works on a 0.1 s grid over the recording. Pure function, no models: combineSpeakers(primary, secondary, duration)
// with segments [{ start, end, speaker }] -> segments [{ start, end, speaker }] (no overlaps, speakers in order of
// first appearance as SPEAKER_00, SPEAKER_01, …).

const STEP = 0.1;
const SPLIT_SHARE = 0.15; // a part of a primary speaker the secondary gives to someone else at least this often …
const SPLIT_MIN_S = 12; // … and for at least this long: the primary merged two people

function grid(segs, n) {
  // frame -> list of speakers active in it (most frames: one)
  const g = Array.from({ length: n }, () => null);
  for (const s of segs) {
    const a = Math.max(0, Math.round(s.start / STEP)), b = Math.min(n, Math.round(s.end / STEP));
    for (let f = a; f < b; f++) {
      if (!g[f]) g[f] = [String(s.speaker)];
      else if (!g[f].includes(String(s.speaker))) g[f].push(String(s.speaker));
    }
  }
  return g;
}

// maxSpeakers (the user chose how many people speak; the secondary was run with that count): any person beyond that
// number (the smallest ones) is folded into the kept person the secondary's labels say they are
// unknown: the secondary's label for speech it could not attribute (engine/diarize.js 'Unknown'): it carries no identity,
// so it is never translated into a person; where the primary names nobody either, the speech stays unknown
export function combineSpeakers(primary, secondary, duration, { maxSpeakers = 0, unknown = null } = {}) {
  const n = Math.max(1, Math.ceil(duration / STEP));
  const P = grid(primary, n), S = grid(secondary, n);
  const one = (x) => (x && x.length === 1 ? x[0] : null);
  const known = (x) => { const s = one(x); return s === unknown ? null : s; };

  // how often each (secondary, primary) pair names the same frame, where both name exactly one person
  const co = new Map();
  for (let f = 0; f < n; f++) {
    const p = one(P[f]), s = known(S[f]);
    if (p == null || s == null) continue;
    const m = co.get(s) || new Map();
    m.set(p, (m.get(p) || 0) + 1);
    co.set(s, m);
  }
  // secondary label -> the primary label it agrees with most
  const tr = new Map([...co].map(([s, m]) => [s, [...m].sort((a, b) => b[1] - a[1])[0][0]]));
  // primary speakers the secondary divides into several people
  const split = new Map();
  const byPrimary = new Map();
  for (const [s, m] of co) for (const [p, c] of m) { const x = byPrimary.get(p) || new Map(); x.set(s, c); byPrimary.set(p, x); }
  for (const [p, m] of byPrimary) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const parts = [...m].filter(([, c]) => c * STEP >= SPLIT_MIN_S && c >= SPLIT_SHARE * total).sort((a, b) => b[1] - a[1]);
    if (parts.length > 1) split.set(p, new Map(parts.map(([s], k) => [s, k === 0 ? p : `${p}~${s}`])));
  }

  const labels = new Array(n).fill(null);
  for (let f = 0; f < n; f++) {
    const p = one(P[f]), s = known(S[f]);
    if (p != null) labels[f] = split.get(p)?.get(s) ?? p;
    else if (s != null && tr.has(s)) { const q = tr.get(s); labels[f] = split.get(q)?.get(s) ?? q; }
    else if (s != null) labels[f] = `~${s}`; // a secondary speaker the primary never matched: kept as its own person
    else if (unknown != null && one(S[f]) === unknown) labels[f] = unknown;
  }

  if (maxSpeakers > 0) {
    const size = new Map();
    for (const l of labels) if (l != null && l !== unknown) size.set(l, (size.get(l) || 0) + 1);
    if (size.size > maxSpeakers) {
      const kept = new Set([...size].sort((a, b) => b[1] - a[1]).slice(0, maxSpeakers).map(([l]) => l));
      // each secondary person -> the kept person it shares most frames with; each extra person -> the kept person
      // its frames most often belong to by that route
      const share = new Map();
      for (let f = 0; f < n; f++) {
        const s = known(S[f]), l = labels[f];
        if (s == null || l == null || !kept.has(l)) continue;
        const m = share.get(s) || new Map();
        m.set(l, (m.get(l) || 0) + 1);
        share.set(s, m);
      }
      const keptOf = new Map([...share].map(([s, m]) => [s, [...m].sort((a, b) => b[1] - a[1])[0][0]]));
      const votes = new Map();
      for (let f = 0; f < n; f++) {
        const l = labels[f], s = known(S[f]);
        if (l == null || kept.has(l) || s == null || !keptOf.has(s)) continue;
        const m = votes.get(l) || new Map();
        m.set(keptOf.get(s), (m.get(keptOf.get(s)) || 0) + 1);
        votes.set(l, m);
      }
      const fold = new Map([...votes].map(([l, m]) => [l, [...m].sort((a, b) => b[1] - a[1])[0][0]]));
      const biggest = [...kept][0];
      for (let f = 0; f < n; f++) {
        const l = labels[f];
        if (l == null || kept.has(l) || l === unknown) continue;
        const s = known(S[f]);
        labels[f] = (s != null && keptOf.get(s)) || fold.get(l) || biggest;
      }
    }
  }

  // frames -> segments, renamed SPEAKER_00… in order of first appearance
  const names = new Map();
  const out = [];
  for (let f = 0; f < n; f++) {
    const l = labels[f];
    if (l == null) continue;
    if (!names.has(l)) names.set(l, l === unknown ? unknown : `SPEAKER_${String([...names.keys()].filter((x) => x !== unknown).length).padStart(2, '0')}`);
    const sp = names.get(l), last = out.at(-1);
    if (last && last.speaker === sp && Math.abs(last.end - f * STEP) < 1e-6) last.end = +((f + 1) * STEP).toFixed(3);
    else out.push({ start: +(f * STEP).toFixed(3), end: +((f + 1) * STEP).toFixed(3), speaker: sp });
  }
  return out;
}

// Whether to use the combined result at all. Measured to help with two or three speakers (and on AMI's four-person
// meetings), but on VoxConverse dev recordings with four or more people it made some clearly worse, so with more than
// three it is not used: the secondary's result is kept as is (accuracy/research/speaker-2026-10-30/PROTOCOL.md,
// addendum 3). The count is the primary's own: people who talk for at least 5 s in total. chosen = the number of
// people the user said speak (0 = not said).
export const COMBINE_MAX_SPEAKERS = 3;
const MIN_TALK_S = 5;
export function primaryCount(primary) {
  const time = new Map();
  for (const s of primary) time.set(s.speaker, (time.get(s.speaker) || 0) + (s.end - s.start));
  return [...time.values()].filter((t) => t >= MIN_TALK_S).length;
}
export function shouldCombine(primary, chosen = 0) {
  if (chosen) return chosen <= COMBINE_MAX_SPEAKERS;
  return primaryCount(primary) <= COMBINE_MAX_SPEAKERS;
}
