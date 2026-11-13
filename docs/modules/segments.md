# Transcript segments (`src/lib/segments.js`)

The line-level form of a transcript that summaries, chapters and Ask answers point into. It is shared by the browser and the server functions so both agree on **line numbers** and **timestamps**. Pure functions only (no browser or Node APIs).

Tests: `tests/segments-clock-test.mjs`, `tests/segments-stored-test.mjs`, `tests/segments-rows-test.mjs`, `tests/segments-citations-test.mjs`, `tests/segments-answers-test.mjs`, plus a few checks in `tests/service-test.mjs`.

## Stored form

`transcriptions.segments` holds `[{ s, e, sp, t, o? }]` (compact keys):

| key | meaning |
|---|---|
| `s`, `e` | start and end, seconds, rounded to 2 decimals |
| `sp` | the speaker name as shown |
| `t` | the text |
| `o` | the label the line was first transcribed with ("Speaker 1"), only present when the speaker has been renamed |

`toStoredSegments(lines, nameOf, origOf)` converts the browser's result lines; `segmentsToStored(segments)` converts a saved page's segments back. Both add `o` only when it differs from `sp`.

## Reading a row

`segmentsFromRow(row)` returns `{ segments, coarse }` where each segment is `{ id, start, end, speaker, text, orig }`. `id` is the line number used everywhere (starting at 0).

- With `row.segments`: entries that are not objects with a string `t` are dropped, text is trimmed, a bad number becomes `0`, a blank speaker becomes `Unknown`, a missing end falls back to the start. `coarse` is `false`.
- Without them (older saves): the `.txt` paragraphs of `transcript_text` (`[0:14] Speaker 1:` followed by text) are used. Each paragraph ends where the next starts; the last ends at `duration_seconds` (or at its own start). `coarse` is `true`: only paragraph timestamps exist.

## Clocks

- `parseClock('1:02:03')` → `3723`. Any non-numeric part gives `0`.
- `fmtClock(3723)` → `1:02:03`; under an hour it is `m:ss`. Fractions are floored, negatives and `NaN` give `0:00`.

## What the model sees and cites

- `modelLine(s)` → `[12] 3:41 Speaker 1: text`. The number in brackets is what the model cites.
- `citedIds(text)` lists the distinct ids in `[12]`, `[12, 15]` and `[12][15]`, in order of first appearance.
- `splitCitations(text, isValid)` splits into `{ text }` and `{ refs }` parts, keeps only ids that pass `isValid`, and drops a citation with no valid ids. See [../FOUND-ISSUES.md](../FOUND-ISSUES.md) (#1) for a cosmetic quirk when a citation is dropped.
- `estimateTokens(text)` is `ceil(chars / 3.2)`. It errs high on purpose, as there is no tokenizer in the browser or edge.

## Classifying answers and questions

| function | true when |
|---|---|
| `isNotFound` | the text starts with "I couldn't find that in this recording" (straight or curly apostrophe, any case) |
| `isNegativeAnswer` | not found, or it says something was not mentioned / said / covered ("No deadline was mentioned."). Such an answer rightly cites nothing |
| `refersToPlayback` | the question is about the part playing now ("explain this part", "what did he just say?") |
| `isFollowUp` | three words or fewer, or it starts with an opener like "why", "what about", "and" |

`normalizeRecordingType(t)` maps anything unknown to `general`; the types are `general`, `lecture`, `meeting`, `interview`, `podcast`, `voice_message`.
