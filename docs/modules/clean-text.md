# Clean reading view (`src/lib/clean.js`)

`cleanText(text)` produces the "clean" version of a transcript line. It is rule-based on purpose: it can only
delete obvious filler and immediate repetitions, so it never invents words, summarises or changes meaning, and it
costs nothing. The original text is never modified; callers keep both. Covered by `tests/clean-filler-test.mjs` and
`tests/clean-repeats-test.mjs`.

## Removed
- Hesitation sounds: um, uh, erm, er, ah, hmm, mm (stretched spellings too, such as `ummm`). English only.
  - At the start of a sentence the sound is dropped and the next word is capitalised (`Um, so I think` becomes `So I think`).
  - Between commas it is removed with them (`We, uh, need` becomes `We need`).
- Immediately repeated words without a comma (`the the`).
- Repeated phrases of 2 to 4 words, with an optional comma (`I think, I think`).
- Stutter fragments whose letters start the next word (`I- I`, `w- we`).

## Kept
- Words that can carry meaning: like, you know, so, well, actually, I mean.
- Numbers (`2 2` is left alone) and negations.
- Emphasis written with commas (`no, no, no`, `very, very important`).
- Anything in other languages (only English hesitation sounds are listed).
- A line that is only filler (`hmm`, `Um...`) is returned unchanged rather than vanishing.

## Edge behaviour
- `null`, `undefined` and empty input return `''`; other values are converted with `String()`.
- Whitespace-only text is returned as it was.
- Running it twice gives the same result as running it once.
