# Tuned constants and the tests that pin them

Several modules hold numbers that were **chosen by measuring** on development recordings, not derived. Changing one
changes accuracy or cost, so each is pinned by a test that fails loudly. Read the comment next to the constant in the
source before changing it; where it points to `accuracy/` or `PROTOCOL.md`, re-run that measurement.

| constant | value | file | pinned by |
|---|---|---|---|
| `SPLIT_SHARE` / `SPLIT_MIN_S` (a primary speaker the secondary divides) | 15 % / 12 s (not exported) | `src/engine/combine.js` | behaviour in `tests/combine-test.mjs` |
| `COMBINE_MAX_SPEAKERS` | 3 | `src/engine/combine.js` | `tests/combine-gate-test.mjs` |
| `MIN_TALK_S` (a speaker must talk this long to count) | 5 s | `src/engine/combine.js`, `src/engine/voice-guard.js` (two separate constants) | `tests/combine-gate-test.mjs`, `tests/voice-guard-constants-test.mjs` |
| `SAMPLE_MIN_S` / `SAMPLE_MAX_S` / `SAMPLES_PER_SPEAKER` | 1 s / 4 s / 8 | `src/engine/voice-guard.js` | `tests/voice-guard-constants-test.mjs` |
| `SAME_VOICE` (similarity at which two voices are the same) | 0.6 | `src/engine/voice-guard.js` | `tests/voice-guard-constants-test.mjs` |
| `MAX_PEOPLE` | 4 | `src/engine/voice-guard.js` | `tests/voice-guard-constants-test.mjs` |
| `MIN_RUN_S` / `MIN_WORDS` / `SNAP_WORDS` | 0.5 s / 1 / 1 | `src/engine/speaker-words.js` | `tests/speaker-words-words-test.mjs` |
| `ALIGN_SETTINGS` (`lead`, `gaps` = wildcard; `wildcardLogP`) | wildcard, wildcard, log 0.3 | `src/lib/ctc-align.js` | `tests/ctc-letters-test.mjs` |
| `TAKEOVER_S` | 0.5 s | `src/lib/ctc-align.js` | `tests/ctc-letters-test.mjs` |
| `PART_BYTES` (largest piece stored in one cache entry) | 128 MiB | `src/engine/model-cache.js` | not pinned: `tests/model-cache-test.mjs` uses a small `partBytes` override to test splitting |
| `NEMOTRON_BASE`, `NEMOTRON_FILES` (pinned commit, SHA-256 per file) | see file | `src/engine/nemotron-files.js` | `tests/nemotron-pinned-test.mjs`, `tests/nemotron-files-test.mjs` |
| `FULL_CONTEXT_TOKENS` / `CONTEXT_BUDGET_TOKENS` | 7000 / 6000 | `server/ai/retrieve.js` | `tests/service-constants-test.mjs` |
| `MAX_INSTRUCTIONS` | 500 characters | `src/lib/tool-settings.js` | `tests/tool-settings-spec-test.mjs` |
| card counts (8 / 15 / 25, "fewer" min 5, "more" max 40) | see `cardCount` | `server/ai/tools.js` | `tests/card-counts-test.mjs` |
| quiz lengths (5 or 10; 3 / 5 / 8 / 15 variants) | see `quizQuestionCount` | `src/lib/tool-settings.js` | `tests/card-counts-test.mjs` |
| the loop thresholds (8 single repeats, 6 repeats of a longer unit) | 8 / 6 | `src/engine/loops.js` | `tests/loops-test.mjs` ([loop-detection.md](loop-detection.md)) |

## Why two copies of `MIN_TALK_S`?
`combine.js` and `voice-guard.js` each define their own 5 second bar for "this person really talks". The two are
independent today (one counts the primary engine's speakers, the other the people compared by voice), so changing one
does **not** change the other. If they are ever meant to move together, they should be exported from one place and the
two tests above updated.

## Keeping this page honest
The table lists where each value lives and which test would fail; it deliberately does not explain the numbers. For
the reasoning, follow the file's own header comment. When you add a measured constant, add a row here.
