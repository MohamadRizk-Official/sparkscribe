# Combining two speaker results (`src/engine/combine.js`)

SparkScribe has two "who spoke when" engines. The **primary** is Nemotron-3-Diarization; the **secondary** is the
pyannote + WeSpeaker engine in `src/engine/diarize.js`. Measured together they were more accurate than either alone
(`accuracy/README.md`), so `combineSpeakers` merges them. It is a pure function: no models, no DOM.
Covered by `tests/combine-test.mjs` (behaviour) and `tests/combine-gate-test.mjs` (when it is used).

## Input and output
`combineSpeakers(primary, secondary, duration, { maxSpeakers = 0, unknown = null })`

- `primary`, `secondary`: arrays of `{ start, end, speaker }` in seconds.
- `duration`: length of the recording. The work happens on a **0.1 s grid** (`STEP`), so `duration / 0.1` frames.
- Returns segments with no overlaps, speakers renamed `SPEAKER_00`, `SPEAKER_01`, ... in order of first appearance.
  Neighbouring frames of the same speaker are joined into one segment. Frames nobody speaks in are left out.

## The rules, in the order the code applies them
1. **Trust the primary where it names exactly one person** in a frame. A frame the primary gives to two people at
   once, or to nobody, is not trusted.
2. **Learn a translation.** Wherever both engines name exactly one person in the same frame, count the pair. Each
   secondary label is translated to the primary label it agrees with most often.
3. **Fill the gaps from the secondary.** Where the primary names nobody (or two people), use the secondary's label
   translated into the primary's. A secondary speaker the primary never matched is kept as its own person.
4. **Undo a merge.** If the secondary consistently divides one primary speaker into several people, the primary
   probably merged them (a quiet fourth voice, for example). A part counts as a separate person when the secondary
   gives it at least `SPLIT_SHARE` (15 %) of that primary speaker's frames **and** at least `SPLIT_MIN_S` (12 s). Inside
   that speaker the secondary's division is used; the largest part keeps the primary's label.
5. **Respect a chosen speaker count.** With `maxSpeakers > 0`, only that many people (the biggest by frame count) are
   kept. Each extra person is folded into the kept person the secondary's labels say they are, falling back to the
   most voted kept person and finally the biggest one.
6. **`unknown`** is the secondary's label for speech it could not attribute (`'Unknown'` in `diarize.js`). It never
   becomes a person: it is never translated, and where the primary names nobody either, the speech stays `unknown`.

## When the combined result is used at all
`shouldCombine(primary, chosen = 0)` is the gate:

| situation | result |
|---|---|
| the person said how many people speak (`chosen > 0`) | combine only if `chosen <= COMBINE_MAX_SPEAKERS` (3) |
| not said | combine only if `primaryCount(primary) <= 3` |

`primaryCount` counts the primary's speakers who talk **at least 5 seconds in total** (`MIN_TALK_S`), so a one-word
interjection does not make a meeting look bigger. The limit of three comes from measurements: with four or more people
the combined result was clearly worse on some development recordings, so the secondary's result is kept as it is
(`accuracy/research/speaker-2026-10-30/PROTOCOL.md`, addendum 3).

## Things to know when changing it
- The thresholds (`STEP`, `SPLIT_SHARE`, `SPLIT_MIN_S`, `COMBINE_MAX_SPEAKERS`, the 5 s bar) were chosen on
  development recordings; changing one changes accuracy, so re-run the accuracy lab.
- `MIN_TALK_S` is defined separately in `combine.js` and in `voice-guard.js`; both are 5 seconds today but they are
  independent constants.
