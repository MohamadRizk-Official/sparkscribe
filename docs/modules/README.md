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
| `src/lib/billing.js` | [billing-display.md](billing-display.md) | `tests/billing-display-test.mjs` |
| `src/lib/recovery.js` | [password-recovery.md](password-recovery.md) | `tests/recovery-session-test.mjs` |
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
| `server/ai/study.js` (prompts, validation) | [study-validation.md](study-validation.md) | `tests/study-instructions-test.mjs`, `tests/study-validate-quiz-test.mjs` |
| `server/ai/tools.js` (what each tool asks for) | [create-tools-catalog.md](create-tools-catalog.md) | `tests/tools-test.mjs`, `tests/tools-validators-test.mjs` |
| `src/engine/model-cache.js`, `src/engine/fetch-model.js` | [model-cache.md](model-cache.md), [fetch-model.md](fetch-model.md) | `tests/model-cache-test.mjs` |
| `src/engine/nemotron-files.js`, `speaker-check.js`, `gpu-device.js` | [nemotron-files.md](nemotron-files.md), [speaker-check.md](speaker-check.md), [gpu-device.md](gpu-device.md) | `tests/nemotron-files-test.mjs` |
| `src/engine/word-timing.js` | [word-timing.md](word-timing.md) | none (needs a browser; alignment is covered by `tests/ctc-align-test.mjs`) |
| `src/mascot/motion.js` | [mascot-motion.md](mascot-motion.md) | `tests/mascot-motion-test.mjs`, `tests/mascot-animator-test.mjs` |
| `src/lib/sentence-timing.js` | [sentence-timing.md](sentence-timing.md) | `tests/sentence-timing-test.mjs` |
| `src/insights/api.js` | [insights-api.md](insights-api.md) | `tests/insights-api-unconfigured-test.mjs` |
| `accuracy/lab/*.mjs` | [accuracy-lab-metrics.md](accuracy-lab-metrics.md) | `tests/metrics-test.mjs`, `tests/lab-metrics-parts-test.mjs`, `tests/lab-reference-test.mjs`, `tests/lab-spans-diagnostics-test.mjs` |
| `server/ai/across.js` (combined guide) | [across-guide.md](across-guide.md) | `tests/across-test.mjs`, `tests/across-guide-grounding-test.mjs` |
| `server/ai/across.js` (loading, ask, history) | [across-ask.md](across-ask.md) | `tests/across-test.mjs`, `tests/across-history-test.mjs`, `tests/across-digest-test.mjs` |
| `server/ai/studymap.js`, `server/ai/studyrun.js` | [studymap-pipeline.md](studymap-pipeline.md) | `tests/studymap-test.mjs`, `tests/studymap-helpers-test.mjs`, `tests/studymap-prompts-test.mjs` |
| `src/engine/voice-guard.js` | [voice-guard.md](voice-guard.md) | `tests/voice-guard-test.mjs` |
| `src/engine/speaker-words.js` | [speaker-words-overview.md](speaker-words-overview.md) | `tests/speaker-words-test.mjs` |
| `src/lib/continuation.js` | [continuation.md](continuation.md) | `tests/continuation-test.mjs` |
| `src/lib/fetch-progress.js` | [fetch-progress.md](fetch-progress.md) | `tests/fetch-progress-test.mjs` |
| `src/lib/timing-plan.js` | [timing-plan.md](timing-plan.md) | `tests/timing-plan-test.mjs` |
| `src/lib/metrics.js` | [metrics.md](metrics.md) | `tests/metrics-normalize-test.mjs`, `tests/metrics-wer-test.mjs`, `tests/metrics-terms-speakers-test.mjs` (`tests/metrics-test.mjs` tests the speaker metrics in `accuracy/lab/metrics.mjs`, not this file) |
| `src/lib/pricing-catalog.js` | [pricing-catalog.md](pricing-catalog.md) | `tests/pricing-catalog-test.mjs` |
| `src/insights/answer-format.js` | [answer-format.md](answer-format.md) | `tests/ask-format-test.mjs` |
| `src/insights/focus-review.js` | [focus-review.md](focus-review.md) | `tests/focus-review-test.mjs` |
| `src/home/dashboard.js` | [dashboard.md](dashboard.md) | none (needs a browser and Supabase) |
| `server/ai/tools.js` (validators) | [create-tool-validators.md](create-tool-validators.md) | `tests/tools-validators-test.mjs`, `tests/study-schemas-strict-test.mjs` |
| `src/insights/tools.js` (`localGrade`) | [short-answer-grading.md](short-answer-grading.md) | `tests/local-grade-test.mjs` |
| `src/insights/tools.js` (`artifactBlocks`, `blocksToText`, `toolsFor`) | [create-export-text.md](create-export-text.md) | `tests/artifact-blocks-test.mjs` |
| `server/http.js` | [server-http.md](server-http.md) | `tests/http-test.mjs`, `tests/http-helpers-test.mjs` |
| `server/db.js` | [server-db.md](server-db.md) | none: needs a database (in-memory stores in `tests/service-test.mjs`) |
| `server/ai/anthropic.js` | [anthropic-provider.md](anthropic-provider.md) | `tests/anthropic-provider-test.mjs` |
| `src/lib/breath.js` (envelope, start points) | [breath-envelope.md](breath-envelope.md) | `tests/breath-envelope-test.mjs` |
| `src/lib/supabase.js` (unconfigured) | the header comment in the file | `tests/supabase-unconfigured-test.mjs` |
| `src/engine/combine.js` | [combine-speakers.md](combine-speakers.md) | `tests/combine-test.mjs`, `tests/combine-gate-test.mjs` |
| `src/engine/decoding.js` | [decoding.md](decoding.md) | `tests/whisper-control-test.mjs`, `tests/compat-test.mjs` |
| tuned numbers across modules | [tuned-constants.md](tuned-constants.md) | the tests it lists |
| `src/lib/quiz-sound.js` | the header comment in the file | `tests/quiz-sound-test.mjs` |
| `src/lib/captcha.js` | [captcha.md](captcha.md) | `tests/captcha-test.mjs` |
| `src/lib/prefs.js` | [prefs.md](prefs.md) | `tests/prefs-test.mjs` |
| `src/lib/quiz-sound.js` | [quiz-sound.md](quiz-sound.md) | `tests/quiz-sound-test.mjs` |
| `src/lib/related-material.js` | [related-material.md](related-material.md) | `tests/related-material-brand-test.mjs` |
| `src/lib/onset-head.js` | [onset-head.md](onset-head.md) | `tests/onset-test.mjs`, `tests/onset-head-shape-test.mjs` |
| `src/lib/theme-toggle.js`, `src/lib/details-pop.js`, `src/lib/brand.js` | [small-ui-widgets.md](small-ui-widgets.md) | none: browser-only |
| `server/billing/service.js` | [billing-service.md](billing-service.md) | none: needs Stripe and Supabase (see `qa/`) |
| `server/ai/service.js` | [ai-service.md](ai-service.md) | `tests/service-test.mjs`, `tests/service-constants-test.mjs`, `tests/ai-limits-test.mjs` |
| `src/engine/nemotron.js` | [nemotron-diarization.md](nemotron-diarization.md) | `tests/nemotron-features-test.mjs`, `tests/nemotron-diarize-stub-test.mjs` |
| `src/electric/transport.js`, `src/electric/speed-menu.js` | [audio-player-controls.md](audio-player-controls.md) | `tests/electric-helpers-test.mjs` (speed options only) |
| `src/audio.js` | [audio-decoding.md](audio-decoding.md) | `tests/audio-peaks-test.mjs` (peaks only) |
| `src/electric/thunder.js` | [thunder-upgrade-dialog.md](thunder-upgrade-dialog.md) | none: browser-only |
| `src/electric/chrome.js` | [electric-chrome.md](electric-chrome.md) | none: browser-only |
| `src/electric/sound-wave.js` | [electric-sound-wave.md](electric-sound-wave.md) | none: browser-only (WebGL) |
| `src/pages/pricing.js` | [pricing-page.md](pricing-page.md) | none: browser-only |
| `src/pages/settings.js` | [settings-page.md](settings-page.md) | none: browser-only |
| `src/pages/account.js` | [account-page.md](account-page.md) | none: browser-only |
| `src/pages/eval.js` | [accuracy-lab-page.md](accuracy-lab-page.md) | none: browser-only, dev build |
| `src/mascot/stage.js` | [mascot-stage.md](mascot-stage.md) | none: browser-only (WebGL) |
| `src/insights/export.js` | [export-dialog.md](export-dialog.md) | `tests/export-test.mjs`, `tests/export-doc-builders-test.mjs` (the dialog is browser-only) |
| `src/pages/library.js` | [library-page.md](library-page.md) | none: browser-only |

See also [../TESTING.md](../TESTING.md) and [../PROJECT-CONTEXT.md](../PROJECT-CONTEXT.md).
