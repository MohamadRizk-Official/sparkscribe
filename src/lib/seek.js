// Where to start playback for sentence k of a transcript line, from word times: just before the sentence's first word,
// never back into the previous word. Used for every sentence, the first one of a line too (a line's own start time is
// where the speaker detection put the turn, which can sit inside the previous speaker's last word).
//
//   seekToSentence({ text, k, words: [[w, s, e], …] (seconds, absolute), env, lineStart, prevLineEnd, bias })
//     -> seconds, or null when the sentence's first words were not found in the word times
// bias: how late the word times run (whisper-tiny's run ~0.15 s late; forced alignment: 0).
import { splitSentences } from './breath.js';
import { alignWords } from './align-words.js';

export const LEAD_S = 0.05; // start this much before the first word, so its first sound is not clipped (0.1 heard more of the speech before: accuracy/research/speaker-2026-10-30/PROTOCOL.md)
const GAP_S = 0.02; // and at least this much after the previous word ended

// prevEnd: when known, where the speech just before the line ended (e.g. the aligned last word of the line before);
// a first sentence never starts before it
export function seekToSentence(o) {
  const a = sentenceAnchor(o);
  return a && Math.max(0, Math.max(a.onset - (o.lead ?? LEAD_S), Math.min(a.floor, a.onset)));
}

// the sentence's first word as timed (onset), the earliest moment that hears none of the speech before (floor), and
// how many of its first words were not found in the word times (skipped); null when none of its words were found
export function sentenceAnchor({ text, k, words, bias = 0, prevEnd = -Infinity }) {
  if (!words?.length) return null;
  const parts = splitSentences(text);
  const all = parts.flatMap((p) => p.text.trim().split(/\s+/).filter(Boolean));
  let w = 0;
  for (let i = 0; i < k && i < parts.length; i++) w += parts[i].text.trim().split(/\s+/).filter(Boolean).length;
  const n = (parts[k]?.text || '').trim().split(/\s+/).filter(Boolean).length;
  const timed = words.map(([word, s, e]) => ({ w: word, s, e }));
  const map = alignWords(all, timed);
  let j = w;
  while (j < w + n && map[j] < 0) j++;
  if (j >= w + n) return null;
  const at = map[j];
  const onset = timed[at].s - bias - (j - w) * 0.25; // a few unmatched first words: about a quarter second each
  const pw = timed[at - 1];
  // the previous word's end (word ends from whisper run long: at most 0.3 s after its start)
  const floor = pw ? Math.min(pw.e, bias ? pw.s + 0.3 : pw.e) - bias + GAP_S : prevEnd + GAP_S;
  return { onset, floor, skipped: j - w, word: timed[at], prev: pw || null };
}

// The quietest moment in [from, to] (seconds) of 16-bit or float samples: loudness in 10 ms steps, smoothed over 30 ms.
// Where a sentence follows the speech before with hardly a pause, that dip is where one ends and the other begins.
export function quietPoint(samples, rate, from, to, scale = 1) {
  const hop = Math.round(rate / 100), a = Math.max(0, Math.floor(from * rate)), b = Math.min(samples.length, Math.ceil(to * rate));
  const n = Math.floor((b - a) / hop);
  if (n < 3) return null;
  const e = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = a + f * hop, end = i + hop; i < end; i++) { const v = samples[i] * scale; s += v * v; }
    e[f] = s;
  }
  let best = 1, bestV = Infinity;
  for (let f = 1; f < n - 1; f++) { const v = e[f - 1] + e[f] + e[f + 1]; if (v < bestV) { bestV = v; best = f; } }
  return (a + best * hop + hop / 2) / rate;
}
