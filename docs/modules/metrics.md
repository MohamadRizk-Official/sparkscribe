# Accuracy metrics (`src/lib/metrics.js`)

Pure functions used by the eval page and `accuracy/score.mjs`. Test: `tests/metrics-test.mjs`.

- `normalizeText(text, { arabic = true })`: NFKC, lower-case; with `arabic` also drops diacritics and tatweel and folds
  alef forms (إأآٱ→ا), ى→ي, ة→ه, ؤ→و, ئ→ي. Curly quotes become `'`; punctuation becomes spaces; apostrophes at word
  edges are removed; whitespace collapsed.
- `words(text)`: normalised text split on spaces.
- `align(ref, hyp)`: Levenshtein alignment with backtrace → `{ S, D, I, C, N, ops }`, ops `ok | sub | del | ins`.
- `wer(ref, hyp)`: `(S+D+I)/N`. With an empty reference: 1 if the hypothesis has words, else 0.
- `cer(ref, hyp)`: same on characters with spaces removed (better for Arabic).
- `termRecall(terms, hyp)`: `{ found, total, missing }`, whole-word, case/punctuation-insensitive.
- `pct(x)`: `0.123` → `"12.3%"`.
- `speakerAttribution(refTurns, hypLines)`: aligns words as for WER, maps each hypothesis speaker 1:1 to the reference
  speaker it overlaps most (greedy by count, `Unknown` ignored in the mapping) and reports `wder` (aligned words given
  to the wrong person or to Unknown), `falseChanges`, `missedChanges`, `unknownWords`, and speaker counts.
