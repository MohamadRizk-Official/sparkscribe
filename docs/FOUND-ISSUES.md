# Found issues

Behaviour noticed while writing tests and docs. These are write-ups only: nothing here has been changed in the app.

## 1. A dropped citation leaves a space before the full stop

- **Where:** `splitCitations` in `src/lib/segments.js`, used by `groundAnswer` in `server/ai/grounding.js`.
- **What the code says it does:** the comment above the last line of `splitCitations` says the tidy step turns `"Friday [99]."` into `"Friday."`.
- **What happens:** the tidy regex (`/\s+([.,;:!?])/`) runs on each text part on its own. When a citation with no valid ids is removed, the space sits at the end of the part *before* it and the punctuation at the start of the part *after* it, so the regex never sees both.
- **Reproduce:**
  ```js
  import { groundAnswer } from './server/ai/grounding.js';
  groundAnswer('It is due Friday [99]. Done [3].', [3]).answer;
  // "It is due Friday . Done [3]."   (expected "It is due Friday. Done [3].")
  ```
- **Impact:** cosmetic. An Ask answer that cited a line the model was not given shows `Friday .` with a stray space. Answers, citations and the `found` / `unsupported` flags are unaffected.
- **Suggested fix (not applied):** join adjacent text parts before tidying, or trim the end of a text part that is followed by a removed citation and then starts with punctuation.
- **Test status:** the assertion that would expose this was left out of `tests/segments-citations-test.mjs`; the test covers the behaviour that works today.

## 2. A `null` (or blank) entry in `refs` is read as line 0

- **Where:** `cleanRefs` in `server/ai/grounding.js`.
- **What happens:** each ref goes through `Number(r)`. `Number(null)` and `Number('')` are `0`, and `Number(true)` is `1`, and all three pass the `Number.isInteger` check. If the model returns `refs: [null]`, the item is grounded on line 0 instead of being dropped.
- **Reproduce:**
  ```js
  import { cleanRefs, groundStructured } from './server/ai/grounding.js';
  cleanRefs([null, '', true], () => true);   // [0, 1]   (expected [])
  groundStructured({ points: [{ text: 'x', refs: [null] }] }, [{ id: 0, start: 0, text: 'hi' }]).content;
  // { points: [{ text: 'x', refs: [0] }] }   (expected the item dropped)
  ```
- **Impact:** low. The structured-output schema asks for integers, so this only matters if the model breaks its schema. The result would be an ungrounded item that looks grounded on the first line. Quotes and evidence are still checked word for word, so those items are not affected.
- **Suggested fix (not applied):** accept only `typeof r === 'number'` or a non-empty digit string before converting.
- **Test status:** `tests/grounding-extra-test.mjs` does not assert on `null` refs.
