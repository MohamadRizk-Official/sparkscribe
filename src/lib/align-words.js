// Match the words of a transcript paragraph to word timings from the aligner (a small Whisper that only times
// words, src/align-worker.js). The two never read exactly alike (different models, clean view, edits), so the
// texts are aligned like a spelling diff and each sentence takes the time of its first matched word.

const norm = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

// text words -> index into timed words, -1 where there is no counterpart (Levenshtein alignment)
export function alignWords(textWords, timed) {
  const A = textWords.map(norm), B = timed.map((w) => norm(w.w));
  const n = A.length, m = B.length;
  const cost = (i, j) => (A[i] === B[j] ? 0 : A[i] && B[j] && A[i][0] === B[j][0] ? 1 : 1.5);
  const D = new Float32Array((n + 1) * (m + 1));
  const at = (i, j) => i * (m + 1) + j;
  for (let i = 0; i <= n; i++) D[at(i, 0)] = i;
  for (let j = 0; j <= m; j++) D[at(0, j)] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    D[at(i, j)] = Math.min(D[at(i - 1, j - 1)] + cost(i - 1, j - 1), D[at(i - 1, j)] + 1, D[at(i, j - 1)] + 1);
  }
  const map = new Array(n).fill(-1);
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (Math.abs(D[at(i, j)] - (D[at(i - 1, j - 1)] + cost(i - 1, j - 1))) < 1e-6) { if (cost(i - 1, j - 1) < 1.5) map[i - 1] = j - 1; i--; j--; }
    else if (Math.abs(D[at(i, j)] - (D[at(i - 1, j)] + 1)) < 1e-6) i--;
    else j--;
  }
  return map;
}

// When each sentence starts (seconds), from the timed words: [onset | null, …], one per sentence.
// `sentences` = [{ text }] in order, covering the paragraph's text. A sentence whose first words weren't matched
// takes its first matched word, moved back a little per word skipped; none matched -> null.
export function sentenceOnsets(sentences, timed) {
  const words = sentences.map((s) => String(s.text).trim().split(/\s+/).filter(Boolean));
  const flat = words.flat();
  if (!flat.length || !timed?.length) return sentences.map(() => null);
  const map = alignWords(flat, timed);
  const out = [];
  let w = 0;
  for (const ws of words) {
    let j = w;
    while (j < w + ws.length && map[j] < 0) j++;
    out.push(j < w + ws.length ? timed[map[j]].s - (j - w) * 0.25 : null);
    w += ws.length;
  }
  return out;
}
