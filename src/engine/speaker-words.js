// Speaker labels for transcript lines AFTER transcription. Lines stay the clips production transcribes (cut at the
// first speaker engine's turns, worker.js buildTurns), so the words are unchanged; the more accurate speaker result
// (the two engines combined and checked, worker.js doubleCheck) only decides who said them. A line the new result
// gives to one person is relabelled; a line where it hears a speaker change is split there, at its words' times (the
// timing model of sentence clicks, forced alignment of the line's own words: lib/ctc-align.js). Without word times the
// line keeps one label (whoever the new result hears most in it), so text is never moved on a guess.
// accuracy/research/speaker-2026-10-30/PROTOCOL.md, addendum 8.
//
//   labelMap(first, final) -> Map(first-engine label -> final label), for lines the new result says nothing about
//   planLines(lines, final, { map }) -> [{ speaker, runs }] per line; runs.length >= 2: a speaker change inside
//   splitLine(line, times, runs) -> lines (times: [{ s, e } | null] per word of line.text, seconds)
export const MIN_RUN_S = 0.5; // a stretch of one person shorter than this inside a line belongs to its neighbour (chosen on
// development recordings: 0.3 s gave the same accuracy with a third more lines to word-time)
export const MIN_WORDS = 1; // fewer words than this at a speaker change join the neighbouring words
// A change found one word from a sentence end is moved to that sentence end ("What is this? I" / "don't know." becomes
// "What is this?" / "I don't know."): the word times are not exact to a word, Whisper's sentence ends usually are where
// a person stops. Chosen on development recordings: a third fewer pieces split inside a sentence, accuracy unchanged
// (moving two or three words made it slightly worse).
export const SNAP_WORDS = 1;

const UNKNOWN = 'Unknown';
export const wordsOf = (text) => String(text || '').trim().split(/\s+/).filter(Boolean);

export function labelMap(first, final, unknown = UNKNOWN) {
  const ov = new Map();
  for (const a of first) {
    if (a.speaker === unknown) continue;
    for (const b of final) {
      if (b.speaker === unknown || b.end <= a.start || b.start >= a.end) continue;
      const k = a.speaker + '\u0001' + b.speaker;
      ov.set(k, (ov.get(k) || 0) + Math.min(a.end, b.end) - Math.max(a.start, b.start));
    }
  }
  const map = new Map();
  for (const [k] of [...ov].sort((x, y) => y[1] - x[1])) { const [a, b] = k.split('\u0001'); if (!map.has(a)) map.set(a, b); }
  return map;
}

// the final result's stretches inside [start, end]: one per person in turn, short ones joined to a neighbour
export function runsIn(final, start, end, { minRun = MIN_RUN_S, unknown = UNKNOWN } = {}) {
  let runs = [];
  for (const s of final) {
    if (s.speaker === unknown || s.end <= start || s.start >= end) continue;
    const a = Math.max(start, s.start), b = Math.min(end, s.end), l = runs[runs.length - 1];
    if (l && l.speaker === s.speaker) l.end = Math.max(l.end, b);
    else runs.push({ start: a, end: b, speaker: s.speaker });
  }
  runs.sort((x, y) => x.start - y.start);
  while (runs.length > 1) {
    let i = -1, shortest = minRun;
    runs.forEach((r, k) => { if (r.end - r.start < shortest) { shortest = r.end - r.start; i = k; } });
    if (i < 0) break;
    const prev = runs[i - 1], next = runs[i + 1];
    const into = !prev ? next : !next ? prev : prev.end - prev.start >= next.end - next.start ? prev : next;
    into.start = Math.min(into.start, runs[i].start); into.end = Math.max(into.end, runs[i].end);
    runs.splice(i, 1);
    const m = [];
    for (const r of runs) { const l = m[m.length - 1]; if (l && l.speaker === r.speaker) l.end = Math.max(l.end, r.end); else m.push(r); }
    runs = m;
  }
  return runs;
}

export function planLines(lines, final, { map = new Map(), minRun = MIN_RUN_S, unknown = UNKNOWN } = {}) {
  const sorted = [...final].sort((a, b) => a.start - b.start);
  return lines.map((l) => {
    const runs = runsIn(sorted, l.start, l.end, { minRun, unknown });
    if (!runs.length) return { speaker: map.get(l.speaker) ?? l.speaker, runs };
    const most = new Map();
    for (const r of runs) most.set(r.speaker, (most.get(r.speaker) || 0) + r.end - r.start);
    return { speaker: [...most].sort((a, b) => b[1] - a[1])[0][0], runs };
  });
}

// One line split at the speaker changes, by where its words were said. Words without a time (no letters the timing
// model knows: numbers, symbols) go with the word before them. Every word stays, in order; nothing is rewritten.
export function splitLine(line, times, runs, { minWords = MIN_WORDS, snap = SNAP_WORDS } = {}) {
  const words = wordsOf(line.text);
  if (runs.length < 2 || times.length !== words.length || !times.some(Boolean)) return null;
  const who = (t) => {
    const mid = (t.s + t.e) / 2;
    let best = runs[0], d = Infinity;
    for (const r of runs) { const x = mid < r.start ? r.start - mid : mid > r.end ? mid - r.end : 0; if (x < d) { d = x; best = r; } }
    return best.speaker;
  };
  const firstTimed = times.findIndex(Boolean);
  let cur = who(times[firstTimed]);
  const groups = [];
  words.forEach((w, i) => {
    if (times[i]) cur = who(times[i]);
    const g = groups[groups.length - 1];
    if (g && g.speaker === cur) g.words.push(i); else groups.push({ speaker: cur, words: [i] });
  });
  // too few words at a change: they join the neighbour (the longer one), then neighbours of one person rejoin
  for (let k; (k = groups.findIndex((g) => g.words.length < minWords)) >= 0 && groups.length > 1;) {
    const into = k === 0 ? 1 : k === groups.length - 1 ? k - 1 : groups[k - 1].words.length >= groups[k + 1].words.length ? k - 1 : k + 1;
    groups[into].words = into < k ? [...groups[into].words, ...groups[k].words] : [...groups[k].words, ...groups[into].words];
    groups.splice(k, 1);
    for (let j = groups.length - 1; j > 0; j--) if (groups[j].speaker === groups[j - 1].speaker) { groups[j - 1].words.push(...groups[j].words); groups.splice(j, 1); }
  }
  for (let k = 1; k < groups.length && snap > 0; k++) {
    const b = groups[k].words[0];
    let to = null; // the first word after the nearest sentence end, within `snap` words of the change
    for (let d = 0; d <= snap && to == null; d++) for (const j of [b - 1 - d, b - 1 + d]) {
      if (to == null && j >= groups[k - 1].words[0] && j < groups[k].words[groups[k].words.length - 1] && /[.?!]["')\]]*$/.test(words[j])) to = j + 1;
    }
    if (to != null && to !== b) {
      const both = [...groups[k - 1].words, ...groups[k].words];
      groups[k - 1].words = both.filter((i) => i < to); groups[k].words = both.filter((i) => i >= to);
    }
  }
  if (groups.length < 2) return [{ ...line, speaker: groups[0].speaker }];
  // a piece starts at its first timed word (never before the previous piece); the first and last keep the line's edges
  const startOf = (g) => { for (const i of g.words) if (times[i]) return times[i].s; return null; };
  const out = [];
  groups.forEach((g, k) => {
    const s = k === 0 ? line.start : Math.max(out[k - 1].start + 0.01, Math.min(line.end - 0.01, startOf(g) ?? out[k - 1].start + 0.01));
    if (k) out[k - 1].end = s;
    out.push({ ...line, start: k ? +s.toFixed(3) : line.start, end: line.end, speaker: g.speaker, text: g.words.map((i) => words[i]).join(' ') });
  });
  return out;
}
