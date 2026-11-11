# Flashcard spaced review (`src/insights/srs.js`)

Pure functions that decide when a flashcard comes back. Covered by `tests/srs-test.mjs`.

## Model
- After seeing an answer the student rates the card: `again`, `good` or `easy`.
- Intervals in days: **1, 3, 7, 16, 35, 80** (`INTERVALS`). A card's `step` is its index into that list.
- Cards that were never rated are **not** due. Only practised cards are scheduled.

## Stored shape
Kept in the flashcard set's `progress.srs` (`transcription_artifacts.progress`, user-writable, at most 4000 bytes):

```json
{ "<card index>": [dueDay, step] }
```

`dueDay` is whole days since 1970-01-01 UTC (`today()`), `step` an index into `INTERVALS`. About 15 bytes per card.

## Rating rules (`rate(srs, index, rating, now)`)
| rating | new step | due |
|---|---|---|
| `again` | 0 | today |
| `good` | previous step + 1 (a new card starts at 0), capped at 5 | today + `INTERVALS[step]` |
| `easy` | previous step + 2 (a new card lands on step 1), capped at 5 | today + `INTERVALS[step]` |

`rate` returns a new object; the input is never mutated.

## Other functions
- `readSrs(progress)` cleans untrusted stored data: keys must be 1 to 3 digits, values `[int, int]`, steps are clamped to 0 to 5. Anything else is dropped.
- `dueIndexes(srs, cardCount, now)` returns the sorted indexes with `dueDay <= today` that are inside the set (stale indexes beyond `cardCount` are ignored).
- `nextLabel(srs, index, rating)` is the text for the rating buttons: `again today`, `tomorrow`, `in N days`.
