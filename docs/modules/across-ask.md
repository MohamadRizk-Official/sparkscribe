# Across recordings: loading, asking and saved history (`server/ai/across.js`)

[across-guide.md](across-guide.md) covers the combined study guide. This page covers the rest of the file: how a collection of recordings is loaded, how an Ask-across answer is built, and how saved work is reopened. The HTTP side is [../api/across.md](../api/across.md). Tests: `tests/across-test.mjs`, `tests/across-history-test.mjs`, `tests/across-digest-test.mjs`, `tests/across-refs-helpers-test.mjs`.

## Limits
| constant | value | meaning |
|---|---|---|
| `MIN_RECORDINGS` | 2 | fewer is `400 bad_request` "Choose at least 2 recordings." |
| `ASK_MAX_RECORDINGS` | 12 | more is `400 too_many` |
| `GUIDE_MAX_RECORDINGS` | 10 | for guides |
| `EXCERPT_BUDGET` | 9000 tokens | transcript passages per question (about 35 minutes of speech) |
| `DIGEST_TOKENS` | 450 | per recording: its stored overview, trimmed |
| `MAX_COLLECTION_TOKENS` | 1,500,000 | about 75 hours of speech; beyond it, `422 too_long` "These recordings are too long to search together." |
| `RUNNING_WINDOW_MS` | 120,000 | how recent a reserved request must be to count as "still running" |

## `loadCollection(db, ids, { max })`
1. `ids` that are not UUIDs are dropped and the rest de-duplicated.
2. Too few or too many: the errors above.
3. Every recording is read **as the signed-in user** (`db.getTranscription`). Any that do not come back are missing: `404 not_found` "One of the selected recordings is no longer in your library. Remove it and try again." (plural wording for several), with the missing ids in `details`. An id that belongs to someone else is indistinguishable from a deleted one, and nothing else is revealed.
4. Recordings with no text are dropped; if fewer than two remain, `422 empty` "The selected recordings have no text to work with."
5. Recordings are sorted **oldest first** (`createdAt`, then title) and labelled `R1`, `R2`, …, so "earlier" and "later" mean what they say.
6. Each gets `codeOf` (original speaker label to `S1`, `S2`, stable through renames) and `speakers` (`R2.S1` to the current name).

Each entry carries: `id`, `title` ("Untitled recording" if empty), `createdAt`, `duration` (the stored length, else the last line's end), `version`, `segments`, `basis`.
