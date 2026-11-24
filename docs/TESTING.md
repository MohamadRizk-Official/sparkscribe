# Testing guide

Tests are plain Node scripts in `tests/`, using `node:assert/strict`. There is no test runner or framework.

## Running
```
npm ci --ignore-scripts   # if a dependency's install script needs network access you don't have
npm test                  # runs every script in order, stops at the first failure
node tests/srs-test.mjs   # or one script on its own
```
`npm test` is a long `&&` chain in `package.json`: **a new test file must be appended to it**, or CI never runs it.
`npm run test:sql` runs the database tests under `qa/sql/` separately.

## Style used in the existing tests
- First comment line says which module is covered.
- Import with `await import(new URL('../src/...', import.meta.url).href)`.
- A small helper such as `ok(cond, msg)` asserts, counts and prints `ok - <message>`; the last line prints `N checks passed`.
- Messages describe behaviour, not implementation (`'a "close" short answer counts as right'`).
- Prefer deterministic inputs. When randomness is part of the feature (shuffle), assert a property (it is a permutation), not an exact order.

## What can be tested under plain Node
Pure modules with no browser or Supabase imports: most of `src/engine/`, `src/insights/`, and helpers in `src/lib/`
that don't import `supabase.js`. Modules that touch `document` at load time, or load `@huggingface/transformers` /
`onnxruntime-web`, need a browser, a stub, or a split into a pure file first.

### Modules that read `import.meta.env`
`src/lib/supabase.js` and `src/lib/captcha.js` read Vite's `import.meta.env`, which plain Node does not have, so anything
importing them (`account.js`, `library.js`, `transcripts.js`, `prefs.js`, `recovery.js`, `home/exam.js`, …) fails to load.
`tests/vite-env-hook.mjs` is a small Node module hook that rewrites `import.meta.env` to an empty object in files under `src/`.
Register it at the top of a test, **before** importing the module:

```js
import { register } from 'node:module';
register('./vite-env-hook.mjs', import.meta.url);
const T = await import(new URL('../src/lib/transcripts.js', import.meta.url).href);
```

With no env values, Supabase reads as "not configured" and Turnstile as off, so only the pure helpers are worth testing this way
(`tests/exam-plan-test.mjs`, `account-helpers-test.mjs`, `transcripts-helpers-test.mjs`, `library-helpers-test.mjs`,
`prefs-test.mjs`, `captcha-test.mjs`). Browser globals a module uses (`localStorage`, `location`, `window`, `document`) are
stood in for by small objects set on `globalThis` before the import. Still not testable this way: `align-worker.js` and
`worker.js` (they load the speech models).

## Other things that load in plain Node
- **Scripts and the accuracy lab.** Modules under `scripts/` and `accuracy/lab/` that export plain functions can be imported directly (`tests/stripe-permissions-helpers-test.mjs`, `tests/lab-reference-test.mjs`, `tests/lab-metrics-parts-test.mjs`). Importing `scripts/stripe-permissions.mjs` needs no Stripe package; `scripts/stripe-setup.mjs` does, so install dependencies first (`npm ci --ignore-scripts` is enough).
- **Server prompt builders** (`server/ai/study.js`, `studymap.js`, `studyrun.js`, `across.js`) are pure functions returning strings or objects. Assert the parts other code depends on (the count ceiling, the settings fallbacks, the rule text that carries a guarantee), not the whole prompt, so wording can still be improved.
- **Browser globals the module needs only at call time.** `src/mascot/bus.js` touches `window` and `sessionStorage` inside `try`; its test loads it with neither set, then sets small stand-ins (`tests/mascot-bus-test.mjs`). Note that Node re-throws an exception from an event listener asynchronously, so a "listener that throws" case cannot be asserted the way it can in a browser.
- **Factories that start workers lazily.** `createSentenceTiming` (`src/lib/sentence-timing.js`) only creates its worker when timing is enabled; in Node timing is off, so the stored-timings and fallback paths can be tested (`tests/sentence-timing-test.mjs`).
- **Float32 pose data.** Values stored in a `Float32Array` (the mascot's poses) are not equal to the JavaScript number they were set from; compare with a small tolerance.
- **Stand-in model sessions.** `nemotronDiarize` (`src/engine/nemotron.js`) takes its ONNX sessions and `ort` as arguments, so `tests/nemotron-diarize-stub-test.mjs` passes small objects whose `run()` returns a chosen logit pattern and checks the segments that come out. The front end (`nemotronFeatures`) is pure; give it a synthetic mel matrix where each row reads one FFT bin and the result can be checked by hand (`tests/nemotron-features-test.mjs`). The same idea works for any module that receives its model as a parameter.
- **Safety properties over a list of hostile inputs.** `tests/answer-format-safety-test.mjs` does not compare whole HTML strings; it lists tags and attributes the renderer may produce, runs many malicious or malformed model answers through it and checks that nothing outside the list appears. Prefer this for anything that turns untrusted text into markup.
- **Floating-point boundaries.** A rule such as "a gap of at most 0.05 s" cannot be tested with `1.05 - 1`, which is `0.05000000000000004`. Test with values clearly on either side of the limit (`tests/continuation-edges-test.mjs`).

## Pinning values on purpose
A few tests pin exact values because other things depend on them: the draft-instruction fingerprint in
`tool-settings-test.mjs` (changing it orphans stored drafts) and the course tone for a known id in
`course-tone-test.mjs`. If one fails, decide whether the change was intended before editing the test.

## Stand-ins used by the browser-leaning tests
Several `src/lib/` modules import the Supabase client or read `location` / `localStorage`. The existing tests handle that in three ways:
- `register('./vite-env-hook.mjs', import.meta.url)` before the dynamic `import()` makes `import.meta.env` readable in plain Node (no keys, so Supabase reads as "not configured" and no data call is made). Example: `tests/recovery-age-test.mjs`.
- `globalThis.location = new URL('https://www.spark-scribe.com/library?view=all')` stands in for the site origin where a module builds or checks URLs (`tests/account-redirect-edges-test.mjs`).
- `globalThis.localStorage = { getItem, setItem, removeItem }` backed by a `Map` (or no-ops) stands in for storage (`tests/transcripts-format-edges-test.mjs`).

A function that uses `location.pathname` as a default argument throws `ReferenceError` when called without that argument in Node: pass the argument explicitly in the test.

## Edge-case files
Some modules have a second file named `<topic>-edges-test.mjs` (or a name that says what it adds, such as `tool-settings-keys-test.mjs`) next to the first test. These add boundary inputs (empty, null, negative, over-limit, hostile) without touching the original file. Each starts with a comment that names the module and the behaviour covered, and is listed at the end of the `test` script like any other.

When a new assertion fails because of a genuine app bug, don't weaken the test: leave the assertion out and describe the behaviour in `docs/FOUND-ISSUES.md` (what the code says, what happens, a reproduction, the impact), as was done for the dropped-citation space.

## Repository checks
Two tests look at the repository itself rather than at app code:
- `tests/test-script-wiring-test.mjs` fails if a `tests/*-test.mjs` file is missing from the `test` script in `package.json`, is listed twice, or is listed but does not exist.
- `tests/module-docs-links-test.mjs` fails if a guide in `docs/modules/` is not linked from its README, or names a `src/`, `server/` or `tests/` file that does not exist, or links to a guide that does not exist. Rename a file and this tells you which guide to update.

## Module guides
Short explanations of tested modules are in `docs/modules/`.
