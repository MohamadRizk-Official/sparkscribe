# Choosing context for Ask (`server/ai/retrieve.js`)

A short recording is sent to the model whole. A long one is cut down to the lines most likely to answer the question. Tests: `tests/retrieve-chunks-test.mjs`, `tests/retrieve-select-test.mjs`, and `needsRetrieval` / `selectContext` in `tests/service-test.mjs`.

## When retrieval is used

`needsRetrieval(segments)` is true when the whole transcript, written as model lines, is estimated at more than `FULL_CONTEXT_TOKENS` (7000, about 25–30 minutes of speech). Otherwise `selectContext` returns `{ mode: 'full', ids: every line }`.

## Steps in `selectContext(segments, { question, keywords, at, priorityIds, budget })`

1. **Chunk.** `buildChunks` groups consecutive lines. A chunk closes before it would span more than 75 seconds or exceed 170 words. Each chunk keeps its line ids, start, end, word count, text and the lower-cased speakers.
2. **Terms.** `tokenize` lower-cases, keeps letters and digits, drops one-letter tokens and stop words (including question filler such as "explain", "recording", "please"), and applies a light stemmer (`ies` → `y`, then a trailing `ing`, `ed`, `es` or `s`, for words of five or more letters). Words from the question get weight 1; words from `keywords` (query expansion) get 0.6.
3. **Score.** `bm25(chunks, terms)` (k1 1.4, b 0.75). The scores are then adjusted:
   - a chunk with a speaker named in the question: `× 1.6 + 15 %` of the top score;
   - a chunk containing a `priorityIds` line: `+ 80 %` of the top score;
   - a question like "this part" / "right now" with a playback time `at` inside the chunk (±1 s): `+ 200 %` of the top score.
4. **Pick within `budget`** (`CONTEXT_BUDGET_TOKENS`, 6000). Take the best eight chunks, then the chunks either side of them, then any other scoring chunks, skipping any that would not fit. Only chunks with a score above 0 are candidates, so a question that matches nothing selects no lines.
5. **Return** `{ mode: 'retrieval', ids }` with the line ids in time order.

## Writing the prompt

`formatExcerpts(segments, ids, line = modelLine)` writes one line per id and inserts `…` wherever the chosen ids skip part of the recording, so the model knows the excerpts are not continuous.
