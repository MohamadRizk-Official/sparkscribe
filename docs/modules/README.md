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
| `server/entitlements.js` | [entitlements.md](entitlements.md) | `tests/entitlements-test.mjs` |
| `server/ai/provider.js` | [ai-provider.md](ai-provider.md) | `tests/provider-test.mjs` |
| `server/billing/config.js` | [billing-config.md](billing-config.md) | `tests/billing-config-test.mjs` |
| `src/engine/diarize.js` (energy helpers) | [speech-energy.md](speech-energy.md) | `tests/diarize-energy-test.mjs` |
| `src/lib/brand-markup.js` | the shared mark, wordmark and footer HTML used on every page | `tests/brand-markup-test.mjs` |
| `src/lib/theme.js` | System / Light / Dark preference; default is Light, invalid stored values fall back to it | `tests/theme-test.mjs` |
| `src/lib/segments.js` | [segments.md](segments.md) | `tests/segments-clock-test.mjs`, `tests/segments-stored-test.mjs`, `tests/segments-rows-test.mjs`, `tests/segments-citations-test.mjs`, `tests/segments-answers-test.mjs` |
| `src/lib/speaker-refs.js` | [speaker-refs.md](speaker-refs.md) | `tests/speaker-refs-render-test.mjs`, `tests/speaker-refs-orig-codes-test.mjs` |
| `src/lib/across-refs.js` | [across-refs.md](across-refs.md) | `tests/across-test.mjs`, `tests/across-refs-helpers-test.mjs` |
| `src/lib/breath.js`, `src/lib/align-words.js` | [sentences.md](sentences.md) | `tests/split-sentences-test.mjs`, `tests/sentence-onsets-test.mjs` |
| `server/ai/retrieve.js` | [retrieve.md](retrieve.md) | `tests/retrieve-chunks-test.mjs`, `tests/retrieve-select-test.mjs` |
| `server/ai/grounding.js` | [grounding.md](grounding.md) | `tests/grounding-extra-test.mjs` |
| `server/ai/prompts.js` | [prompts.md](prompts.md) | `tests/prompts-schemas-test.mjs`, `tests/prompts-instructions-test.mjs` |
| `src/home/exam.js` | [exam.md](exam.md) | `tests/exam-plan-test.mjs` |
| `src/lib/onnx-output.js` | [onnx-output.md](onnx-output.md) | `tests/onnx-output-test.mjs` |
| `server/ai/usage.js` | [ai-usage.md](ai-usage.md) | `tests/usage-cost-test.mjs`, `tests/usage-meter-test.mjs` |
| `src/lib/audio-store.js` | [audio-store.md](audio-store.md) | `tests/audio-store-test.mjs` |
| `server/ai/mock.js` | [browser-and-dev-helpers.md](browser-and-dev-helpers.md#mock-ai-provider) | `tests/mock-provider-test.mjs` |
| `src/lib/account.js`, `transcripts.js`, `library.js`, `prefs.js`, `captcha.js` | [browser-and-dev-helpers.md](browser-and-dev-helpers.md) | `tests/account-helpers-test.mjs`, `tests/transcripts-helpers-test.mjs`, `tests/library-helpers-test.mjs`, `tests/prefs-test.mjs`, `tests/captcha-test.mjs` |
| `server/ai/study.js`, `server/ai/studymap.js` (helpers) | the header comments in each file | `tests/study-helpers-test.mjs`, `tests/studymap-helpers-test.mjs` |
| `src/engine/model-cache.js`, `src/engine/fetch-model.js` | [model-cache.md](model-cache.md), [fetch-model.md](fetch-model.md) | `tests/model-cache-test.mjs` |
| `src/engine/nemotron-files.js`, `speaker-check.js`, `gpu-device.js` | [nemotron-files.md](nemotron-files.md), [speaker-check.md](speaker-check.md), [gpu-device.md](gpu-device.md) | `tests/nemotron-files-test.mjs` |
| `src/engine/voice-guard.js` | [voice-guard.md](voice-guard.md) | `tests/voice-guard-test.mjs` |
| `src/engine/speaker-words.js` | [speaker-words-overview.md](speaker-words-overview.md) | `tests/speaker-words-test.mjs` |
| `src/lib/continuation.js` | [continuation.md](continuation.md) | `tests/continuation-test.mjs` |
| `src/lib/fetch-progress.js` | [fetch-progress.md](fetch-progress.md) | `tests/fetch-progress-test.mjs` |
| `src/lib/timing-plan.js` | [timing-plan.md](timing-plan.md) | `tests/timing-plan-test.mjs` |
| `src/lib/metrics.js` | [metrics.md](metrics.md) | `tests/metrics-test.mjs` |
| `src/lib/pricing-catalog.js` | [pricing-catalog.md](pricing-catalog.md) | `tests/pricing-catalog-test.mjs` |
| `src/insights/answer-format.js` | [answer-format.md](answer-format.md) | `tests/ask-format-test.mjs` |
| `src/insights/focus-review.js` | [focus-review.md](focus-review.md) | `tests/focus-review-test.mjs` |
| `src/home/dashboard.js` | [dashboard.md](dashboard.md) | none (needs a browser and Supabase) |

See also [../TESTING.md](../TESTING.md) and [../PROJECT-CONTEXT.md](../PROJECT-CONTEXT.md).
