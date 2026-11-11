# Sentence seek times (`src/lib/seek.js`)

Where playback starts when the user clicks sentence `k` of a transcript line, computed from word times. Covered by
`tests/seek-test.mjs`.

## `sentenceAnchor({ text, k, words, bias = 0, prevEnd = -Infinity })`
`words` is `[[word, start, end], ...]` in absolute seconds. The line is split into sentences (`splitSentences` in
`src/lib/breath.js`), its words are aligned with the timed words (`alignWords`), and the first matched word of sentence
`k` is the anchor. Returns `null` when there are no word times or none of the sentence's words were found, else:

- `onset`: the first word's start, minus `bias` (how late the word times run: whisper-tiny about 0.15 s, forced alignment 0) and 0.25 s per unmatched leading word.
- `floor`: the earliest moment that hears none of the speech before: the previous word's end plus 20 ms. With a bias the previous word's end counts as at most 0.3 s after its start. With no previous word, `prevEnd` plus 20 ms.
- `skipped`, `word`, `prev`.

## `seekToSentence(options)`
`max(0, max(onset - lead, min(floor, onset)))`: start `LEAD_S` = 0.05 s before the first word, but never back into the
previous word and never before 0. `lead` can be overridden. `null` when there is no anchor.

## `quietPoint(samples, rate, from, to, scale = 1)`
The quietest moment in `[from, to]` seconds: loudness in 10 ms steps, smoothed over 30 ms, returned as the centre of the
quietest step. Used where a sentence follows the speech before with hardly a pause. Pass `scale` (for example
`1 / 32768`) for 16-bit samples. Returns `null` for windows shorter than three steps; windows are clamped to the data.
