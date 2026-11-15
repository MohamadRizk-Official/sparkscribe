# Speaker labels after transcription (`src/engine/speaker-words.js`)

Lines stay the clips transcribed in production (cut at the first speaker engine's turns, `worker.js buildTurns`), so
**words are never changed**. The more accurate combined speaker result only decides who said them. Test:
`tests/speaker-words-test.mjs`.

- `labelMap(first, final)`: maps each first-engine label to the final label it overlaps most in time (`Unknown` ignored).
  Used for lines the final result says nothing about.
- `runsIn(final, start, end)`: the final result's stretches inside a line, one per person in turn; stretches shorter than
  `MIN_RUN_S = 0.5` s join a neighbour.
- `planLines(lines, final, { map })`: per line `{ speaker, runs }`; two or more runs mean a speaker change inside the line.
- `splitLine(line, times, runs)`: splits a line at the change using word times (forced alignment, `lib/ctc-align.js`).
  Without word times the line keeps a single label (whoever is heard most), so text is never moved on a guess.
- Tuning constants: `MIN_WORDS = 1`; `SNAP_WORDS = 1` moves a change one word from a sentence end onto that end
  ("What is this? I" / "don't know." → "What is this?" / "I don't know.").

Reference: `accuracy/research/speaker-2026-10-30/PROTOCOL.md`, addendum 8. `docs/modules/continuation.md` covers how a
remaining mid-sentence cut is displayed.
