// Word start/end times for a KNOWN text, by CTC forced alignment: a small letter-level speech model (wav2vec2-base-960h)
// says, for every 20 ms of audio, how likely each letter is; the best path that spells exactly the given words through
// those frames (Viterbi over the CTC trellis) gives each word's first and last frame. Unlike asking a speech model to
// transcribe again, it cannot drift onto other words: it can only place the words it is given.
//
//   forcedAlign(logProbs, frames, vocab, words) -> [{ w, s, e } | null, …] seconds from the clip's start
// logProbs: Float32Array [frames x V] log-softmax per 20 ms frame; vocab: token -> id (wav2vec2 tokenizer: '|' is the
// word separator, '<pad>' the CTC blank, upper-case letters and "'"). Words with no letters the model knows (numbers,
// symbols) get null and are timed by their neighbours afterwards.

const FRAME_S = 0.02;

export function lettersOf(word, vocab) {
  return [...String(word).toUpperCase()].filter((c) => vocab[c] != null && c !== '|');
}

// lead: 'wildcard' lets the audio before the first word be anything (another person's speech too), not only silence,
// so that speech is not pulled into the first word; 'blank' (default) explains it as silence
// wildcardLogP: what the wildcard costs per frame against the likeliest letter, so the first word's own letters win the
// frames they compete for (without it the wildcard eats the first letter and the word is placed late)
// gaps: 'wildcard' does the same between words: speech the text leaves out ("um", "uh", a dropped word) is absorbed in
// the gap instead of stretching the next word back over it
export function forcedAlign(logProbs, frames, vocab, words, { lead = 'blank', gaps = 'blank', wildcardLogP = Math.log(0.1) } = {}) {
  const V = logProbs.length / frames;
  const blank = vocab['<pad>'] ?? 0;
  // the target: letters of each word, words joined by '|' (word separator)
  const tokens = [], owner = [];
  const sep = vocab['|'];
  words.forEach((w, i) => {
    const ls = lettersOf(w, vocab);
    if (!ls.length) return;
    if (tokens.length && sep != null) { tokens.push(sep); owner.push(-1); }
    for (const c of ls) { tokens.push(vocab[c]); owner.push(i); }
  });
  const out = words.map(() => null);
  const L = tokens.length;
  if (!L || frames < L) return out;
  // trellis over (frame, token): stay on the token (or a blank) or move to the next token
  const NEG = -1e30;
  const T = new Float32Array((frames + 1) * (L + 1)).fill(NEG);
  const back = new Uint8Array((frames + 1) * (L + 1)); // 0 = stayed, 1 = advanced
  const at = (t, j) => t * (L + 1) + j;
  T[at(0, 0)] = 0;
  for (let t = 1; t <= frames; t++) {
    const row = (t - 1) * V;
    const pBlank = logProbs[row + blank];
    let pAny = pBlank;
    if (lead === 'wildcard' || gaps === 'wildcard') { let mx = -Infinity; for (let v = 0; v < V; v++) mx = Math.max(mx, logProbs[row + v]); pAny = Math.max(pBlank, mx + wildcardLogP); }
    const pLead = lead === 'wildcard' ? pAny : pBlank;
    for (let j = 0; j <= Math.min(L, t); j++) {
      // stay: emit a blank (between tokens) or repeat the current token; before the first token, anything (wildcard)
      const stayP = j === 0 ? pLead : owner[j - 1] < 0 && gaps === 'wildcard' ? Math.max(pAny, logProbs[row + tokens[j - 1]]) : Math.max(pBlank, logProbs[row + tokens[j - 1]]);
      const stay = T[at(t - 1, j)] + stayP;
      const adv = j > 0 ? T[at(t - 1, j - 1)] + logProbs[row + tokens[j - 1]] : NEG;
      if (adv > stay) { T[at(t, j)] = adv; back[at(t, j)] = 1; } else T[at(t, j)] = stay;
    }
  }
  // walk back from the end: the frame each token was first entered
  const first = new Int32Array(L).fill(-1), last = new Int32Array(L).fill(-1);
  let j = L;
  for (let t = frames; t > 0 && j > 0; t--) {
    if (last[j - 1] < 0) last[j - 1] = t - 1;
    if (back[at(t, j)] === 1) { first[j - 1] = t - 1; j--; }
  }
  for (let k = 0; k < L; k++) {
    const i = owner[k];
    if (i < 0 || first[k] < 0) continue;
    const s = first[k] * FRAME_S, e = (last[k] + 1) * FRAME_S;
    if (!out[i]) out[i] = { w: words[i], s, e };
    else { out[i].s = Math.min(out[i].s, s); out[i].e = Math.max(out[i].e, e); }
  }
  return out;
}

// A paragraph's words, with the previous paragraph's last words (`context`) aligned first so the end of the speech
// before is placed too. When the context runs past the paragraph's own start (`start`, from the speaker turns) and the
// paragraph's first word lands well after that start, the context words have taken over this paragraph's opening
// words (the previous speaker's last words were quiet or overlapped): the paragraph is then aligned alone, from just
// before its start, on the same model output.
//   alignParagraph(logProbs, frames, vocab, context, words, start) -> { words: [{ w, s, e } | null], prevEnd: s | null }
export const TAKEOVER_S = 0.5;
export function alignParagraph(logProbs, frames, vocab, context, words, start = null, { lead = 'blank', gaps = 'blank', wildcardLogP } = {}) {
  const V = logProbs.length / frames;
  const al = forcedAlign(logProbs, frames, vocab, [...context, ...words], { lead, gaps, wildcardLogP });
  const ctx = al.slice(0, context.length).filter(Boolean);
  const own = al.slice(context.length);
  const prevEnd = ctx.length ? Math.max(...ctx.map((x) => x.e)) : null;
  const firstS = own.find(Boolean)?.s;
  if (prevEnd != null && start != null && firstS != null && prevEnd > start + 0.1 && firstS > start + TAKEOVER_S) {
    const f0 = Math.max(0, Math.floor((start - 0.3) / FRAME_S));
    const alone = forcedAlign(logProbs.subarray(f0 * V), frames - f0, vocab, words, { lead, gaps, wildcardLogP });
    if (alone.some(Boolean)) return { words: alone.map((x) => x && { ...x, s: x.s + f0 * FRAME_S, e: x.e + f0 * FRAME_S }), prevEnd: null, alone: true };
  }
  return { words: own, prevEnd };
}

// Word starts moved to where a word most likely begins by a word-onset score per 20 ms frame (a small learned head on
// the timing model's hidden features): the CTC letters of a drawn-out first word ("Sooo", "Aaand") sit near its END,
// so its aligned start is late. Each word's start is searched from the previous word's last letter (CTC letters come
// late, so a word never starts before the previous one's last letter) to just after its own first letter, and the
// LATEST clear onset there is taken: earlier onsets in that stretch belong to speech before the word (the end of the
// previous word, or a repeat or "um" the transcript leaves out).
//   refineStarts(words, score, t0, { back, ahead, min }) -> words; score[f] = onset logit of frame f, f = (t - t0) / 0.02
// Chosen on development meetings (accuracy/research/speaker-2026-10-30/PROTOCOL.md addendum 4b). The alignment lets
// the audio before the first word and the gaps between words hold speech the transcript leaves out (a repeated word,
// "uh", a false start) at log(0.3) per frame, instead of stretching the next word back over it; then each start moves
// to the latest onset scoring above -1, from the previous word's last letter to the word's own first letter, never
// later than aligned.
export const ALIGN_SETTINGS = { lead: 'wildcard', gaps: 'wildcard', wildcardLogP: Math.log(0.3) };
export const ONSET_SETTINGS = { back: 0.6, ahead: 0, slack: 0.02, min: -1, pick: 'last' };
export function refineStarts(words, score, t0 = 0, { back = 0.6, ahead = 0.06, slack = 0.02, min = 0, pick = 'last' } = {}) {
  const out = words.map((w) => w && { ...w });
  let prev = null;
  for (const w of out) {
    if (!w) continue;
    const lo = Math.max(w.s - back, prev ? prev.e - slack : -Infinity), hi = w.s + ahead;
    const fa = Math.max(0, Math.ceil((lo - t0) / FRAME_S)), fb = Math.min(score.length - 1, Math.floor((hi - t0) / FRAME_S));
    let best = -1;
    if (pick === 'last') {
      // the latest local peak above `min`
      for (let f = fb; f >= fa && best < 0; f--) if (score[f] > min && (f === fb || score[f] >= score[f + 1]) && (f === 0 || score[f] >= score[f - 1])) best = f;
    } else {
      let bv = -Infinity;
      for (let f = fa; f <= fb; f++) if (score[f] > bv) { bv = score[f]; best = f; }
    }
    if (best >= 0) w.s = Math.min(t0 + best * FRAME_S, w.e - FRAME_S);
    prev = w;
  }
  return out;
}
