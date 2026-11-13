# Grounding model output (`server/ai/grounding.js`)

Checks what the model wrote against the transcript before anything is stored or shown. Tests: `tests/grounding-extra-test.mjs` and the grounding checks in `tests/service-test.mjs`. Known quirks: [../FOUND-ISSUES.md](../FOUND-ISSUES.md).

## `cleanRefs(refs, isValid)`
Takes a model's `refs` list and returns valid line ids only: integers that pass `isValid`, de-duplicated, **at most five** (the first five seen), then sorted ascending. Digit strings are accepted. A non-array gives `[]`.

## `groundStructured(content, segments)` → `{ content, dropped }`
Walks a structured result (key points, actions, decisions, dates, quotes…) recursively:

- every `refs` list goes through `cleanRefs` against the lines that exist;
- an object that has `refs` but none valid is removed (and counted in `dropped`);
- a `quote` must appear word for word in the cited lines. The check ignores case, punctuation and spacing, accepts the line either side of each cited line (a sentence can run across two lines), and never accepts a quote of fewer than two words;
- an `evidence` field (decisions, action items) gets the same check;
- strings are trimmed; numbers and other plain values pass through.

## `groundChapters(chapters, segments)`
Chapter titles come from the model but the timestamps never do. A chapter is kept only if `start_ref` is a real line and it has a title. Chapters are sorted by that line's time, a chapter starting less than 20 seconds after the previous one is skipped, and the first remaining chapter is moved to the first line of the recording. Fewer than two chapters left means none (`[]`).

## `groundAnswer(text, allowedIds)`
For Ask answers. Citations of lines the model was not sent are removed (via `splitCitations`) and counted in `invalidCitations`. Returns `{ answer, refs, found, unsupported, invalidCitations }`:

- `found` is true when something is cited, or when the answer is not a "nothing was mentioned" answer;
- `unsupported` is `found` with no citations left, which is an answer the UI should treat as unsupported;
- an uncited negative answer ("No deadline was mentioned.") is valid and is neither.
