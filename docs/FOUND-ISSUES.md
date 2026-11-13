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
