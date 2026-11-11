# Module guides

Short explanations of how individual modules behave, written from the code. Each links to the test that covers it.

| module | guide | test |
|---|---|---|
| `src/insights/srs.js` | [srs.md](srs.md) | `tests/srs-test.mjs` |
| `src/insights/quiz-engine.js` | [quiz-engine.md](quiz-engine.md) | `tests/quiz-engine-test.mjs` |
| `src/lib/clean.js` | [clean-text.md](clean-text.md) | `tests/clean-filler-test.mjs`, `tests/clean-repeats-test.mjs` |
| `src/engine/merge.js` | [chunk-merge.md](chunk-merge.md) | `tests/merge-overlap-test.mjs` |
| `src/engine/loops.js` | [loop-detection.md](loop-detection.md) | `tests/loops-test.mjs` |
| `src/lib/speaker-names.js` | [speaker-names.md](speaker-names.md) | `tests/speaker-names-test.mjs` |
| `src/lib/tool-settings.js` | [tool-settings.md](tool-settings.md) | `tests/tool-settings-test.mjs` |
| `src/engine/preprocess.js` | [audio-analysis.md](audio-analysis.md) | `tests/audio-analysis-test.mjs` |
| `src/lib/seek.js` | [seek.md](seek.md) | `tests/seek-test.mjs` |
| `src/lib/billing.js` | [billing-display.md](billing-display.md) | none (imports Supabase) |
| `src/lib/recovery.js` | [password-recovery.md](password-recovery.md) | none (imports Supabase) |
| `src/lib/course-tone.js` | a course's accent colour: one of cyan, violet, amber, blue, magenta, derived from the course id | `tests/course-tone-test.mjs` |

See also [../TESTING.md](../TESTING.md) and [../PROJECT-CONTEXT.md](../PROJECT-CONTEXT.md).
