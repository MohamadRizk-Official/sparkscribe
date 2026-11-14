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

## Pinning values on purpose
A few tests pin exact values because other things depend on them: the draft-instruction fingerprint in
`tool-settings-test.mjs` (changing it orphans stored drafts) and the course tone for a known id in
`course-tone-test.mjs`. If one fails, decide whether the change was intended before editing the test.

## Module guides
Short explanations of tested modules are in `docs/modules/`.
