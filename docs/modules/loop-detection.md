# Runaway repetition (`src/engine/loops.js`)

Whisper can get stuck repeating (`so, so, so, so...`, `m m m m...`). These pure functions detect that without
touching ordinary emphasis (`no, no, no`, `very, very important`). They are used by the decoder
(`src/engine/decoding.js`, `src/worker.js`). Covered by `tests/loops-test.mjs`.

## What counts as a loop
`isLoopRun(unitLen, reps)`:
- one token or word repeated **8 or more** times (`LOOP_SINGLE_REPS`), or
- a unit of 2 to 8 tokens (2 to 4 words) repeated **6 or more** times (`LOOP_UNIT_REPS`).

People repeat for emphasis 2 to 4 times, so those never trigger.

## Functions
- `tailRepetition(tokens)` returns the longest run at the end of a token list made of one repeated unit of 1 to 8 tokens, as `{ unit, reps, start }`, or `null`.
- `wordKeys(text)` lower-cases words and strips everything but letters, digits and apostrophes.
- `cutTextLoop(text, unit = null)` finds a trailing run of one repeated 1 to 4 word unit in decoded text.
  - Without `unit`, the run must be pathological. With `unit` (the decoder was already stopped for looping on it) even a short run is cut.
  - A repeated multi-word phrase keeps one copy (`I hope so. I hope so. ...` becomes `I hope so.`); a repeated single word keeps none (`you know? so so so ...` becomes `you know?`).
  - A loop that stopped mid-phrase is treated as the same run and extended backwards.
  - Returns `{ text, loop: { unit, repeats, removedWords } }` or `null`.
- `tidy(s)` collapses punctuation debris (`,,,,`); `tidyCut(s)` also removes dangling punctuation left where a loop was cut.
