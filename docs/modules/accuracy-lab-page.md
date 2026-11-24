# Accuracy lab page (`src/pages/eval.js`)

A **developer-only** page (`eval.html`) that runs the same transcription worker the app uses (`src/worker.js`), item by item, for each configuration, and scores the result against a reference transcript. It is built only with `vite build --mode eval` (`npm run eval:build`, then `npm run eval:serve` on port 4174); the normal production build does not include it and it is never deployed. The pure scoring maths lives in `src/lib/metrics.js` ([metrics.md](metrics.md)); the offline diarization tooling is described in [accuracy-lab-metrics.md](accuracy-lab-metrics.md).

## Inputs
Two ways to load a test set:
1. **Load set**: fetches `<path>/index.json` (`{ items: [{ name, audio, ref, meta?, turns? }] }`) and each file it names.
2. **Choose folder**: groups files by base name: `<name>.<audio ext>` (wav, mp3, m4a, mp4, ogg, opus, webm, flac, aac, mov), `<name>.ref.txt` (reference text), optional `<name>.meta.json` and `<name>.turns.json`. An item needs at least audio and a reference; items are sorted by name. A leading byte-order mark in the JSON files is stripped.

`meta` may hold `language`, `category`, `speakers` (expected count) and `vocabulary` (important words). `turns` is the ground-truth speaker turns.

## Configurations
A JSON array in the "configs" box, default `[{ label: 'Fast', mode: 'fast' }, { label: 'Best Accuracy', mode: 'best' }]`. Each entry is merged over the defaults `{ mode: 'best', language: <meta>, diarize: true, numSpeakers: 0, vocabulary: [] }`, so any worker setting can be overridden. The "use speakers from meta" and "use vocabulary from meta" boxes fill `numSpeakers` / `vocabulary` from the item only when the configuration does not set them itself. A regular-expression filter limits which items run.

## Run
For every configuration and item: decode to 16 kHz mono (`decodeToMono16k`), post a `run` message to one shared worker, wait for `complete` (or `error`), and time it. Each result records: WER with substitutions / deletions / insertions / reference words, CER, real-time factor (processing time ÷ audio length), important-word recall, expected vs found speaker count (`Unknown` is not counted), retried and uncertain segment counts, the model used, speaker-attribution numbers (when turns exist), the transcript lines, and any error text. A failing item is recorded with its error, not thrown, so the rest still run.

## Output
- A **summary table per configuration** pools the counts (pooled WER = total errors ÷ total reference words, not an average of per-file rates), important words found, how often the speaker count was right, words given to the wrong speaker, unknown words, and false / missed speaker changes.
- A **per-item table** with the same measures.
- **Download** writes `accuracy-<date><time>.json` (without the word-level alignment ops).
- `window.__evalResults()` returns the results for scripted runs; `window.__results` is set after each render.

Browser-only: not covered by an automated test; the maths it uses is (`tests/metrics-wer-test.mjs`, `tests/metrics-normalize-test.mjs`, `tests/metrics-terms-speakers-test.mjs`).
