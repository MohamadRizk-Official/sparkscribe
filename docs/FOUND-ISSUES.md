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

## 3. `safeNext` lets `/.//evil.example` through, which becomes the protocol-relative `//evil.example`

- **Where:** `safeNext` in `src/lib/account.js`, used for the `next` parameter in `src/pages/auth.js` and `src/pages/callback.js`.
- **What the code says it does:** "Only ever redirect to a path on this site." It rejects control characters and backslashes, then lets the URL parser decide the origin, and returns `u.pathname + u.search + u.hash`.
- **What happens:** the parser resolves dot segments, so the origin check passes (the resolved URL really is on this site), but the *returned path* is the parser's normalised pathname. For `/.//evil.example` and `/..//evil.example` that pathname is `//evil.example`. Handed to `location.replace(next)`, a path that starts with `//` is read by the browser as a link to another site.
- **Reproduce:**
  ```js
  // in a browser console on the site, or in Node with location = new URL('https://www.spark-scribe.com/')
  safeNext('/.//evil.example');    // "//evil.example"   (expected "/" )
  safeNext('/..//evil.example');   // "//evil.example"   (expected "/" )
  ```
  The same thing in plain Node: `new URL('/.//evil.example', 'https://www.spark-scribe.com').pathname === '//evil.example'`.
- **Impact:** an open redirect after sign-in. A link such as `https://www.spark-scribe.com/auth?next=/.//evil.example` would send the person to `evil.example` once they have signed in (`location.replace(next)` in `src/pages/auth.js` and `src/pages/callback.js`). It cannot read the session. It could be used for phishing from a trusted link.
- **Suggested fix (not applied):** after the origin check, reject (or return the fallback for) any result that starts with `//`, for example `const out = u.pathname + u.search + u.hash; return out.startsWith('//') ? fallback : out;`. Rejecting `.` and `..` segments in the input would also work.
- **Test status:** `tests/account-helpers-test.mjs` covers everything `safeNext` already handles (absolute URLs, `//host`, backslashes, tab/newline tricks, control characters, `javascript:`) and leaves this case out.
