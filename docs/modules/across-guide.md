# Combined study guide across recordings (`server/ai/across.js`)

One synthesis call turns the stored study maps of several recordings into one guide. The page that asks for it first
makes sure each recording has a current map (`needs_maps` error otherwise). The ask-across side is in the file's header
comment; this page covers the guide. Covered by `tests/across-test.mjs` (end to end with the mock provider) and
`tests/across-guide-grounding-test.mjs` (grounding and prompt).

## Limits
`MIN_RECORDINGS = 2`, `ASK_MAX_RECORDINGS = 12`, `GUIDE_MAX_RECORDINGS = 10`. A guide uses at most 28 concepts per recording. Recordings are labelled `R1`, `R2`, … oldest first.

## `guideInstructions(blocks, focus)`
`blocks` are the recordings' maps rendered as text, with concept references like `R2.c5` (recording R2, concept c5). The prompt asks for themes (usually 4–10, grouping the same idea across recordings), a comparison only when the recordings genuinely differ, definitions, distinctions and self-check questions. Rules it states: attributed views stay attributed, every item lists the concept references it rests on "exactly as given", nothing outside the maps may be added, and recordings and speakers are written as `{{R2}}` / `{{R2.S1}}` tokens, never by title or name. With `focus === 'exam'` the self-check favours what a student would most likely be examined on; any other focus leaves that out.

## `groundGuide(json, known, recs)` → `{ content, dropped }`
`known` maps a concept reference to `{ rec, concept }`. Every list item is kept only if at least one of its references exists.

- Each reference is trimmed and looked up. An unknown reference is counted in `dropped`; so is each item left with no sources.
- A source is `{ key, label, transcriptionId, title, concept, line, start }`. `line` is the concept's first line (or `null`) and `start` that line's start time in seconds (0 when there is none). A concept given twice in one item is listed once.
- Text fields are passed through `tokenizeAcross`, so labels the model wrote become `{{R1}}` tokens, and a saved result shows the recordings' **current** titles and speaker names.
- Themes also get `recordings`: the labels of their sources, sorted numerically. `content.recurring` counts themes spanning two or more recordings.
- Missing sections ground to empty lists; a missing overview becomes `''`.
