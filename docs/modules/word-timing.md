# Word timing for speaker splits (`src/engine/word-timing.js`)

Gives each word of a transcript line a start and end time, so a line can be split where the speaker changes
(`worker.js` `assignSpeakers`, `src/engine/speaker-words.js`). It uses forced alignment of the line's own words
(`src/lib/ctc-align.js`) against the same wav2vec2 model that sentence clicks use (`Xenova/wav2vec2-base-960h`, half
precision), so once sentence clicks have downloaded it nothing more is fetched. It needs a browser or worker (it imports
`@huggingface/transformers`), so it has no plain-Node test; the alignment itself is covered by `tests/ctc-align-test.mjs`.

## `loadTiming(dev, progress_callback, gpu = null)`
Returns `{ processor, model, vocab, device }`.

- With `dev === 'webgpu'` and a GPU device given, `timingPlan()` (`src/lib/timing-plan.js`) lists the `[device, dtype]` pairs to try, in order. Otherwise the only plan is `['wasm', 'fp16']`.
- When the plan is WebGPU the model is bound to the caller's own device (`session_options.executionProviders`), so the caller can destroy that device afterwards and get its GPU memory back (see [gpu-device.md](gpu-device.md)).
- Each plan entry is tried in turn; a failure is remembered and the next entry is tried. If every entry fails, the last error is thrown.
- `vocab` is always a plain object (a `Map` vocabulary is converted).

## `timeClip(timing, { audio, offset, words })`
Runs the model on `audio`, turns the logits into log-probabilities (a numerically stable log-softmax per frame; float16
logits are converted to float32 first) and calls `forcedAlign` with `ALIGN_SETTINGS`. Returns one entry per word:
`{ s, e }` in seconds, with `offset` added so times are positions in the whole recording, or `null` for a word that could
not be aligned.
