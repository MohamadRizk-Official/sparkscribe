# Nemotron speaker model (`src/engine/nemotron.js`)

The second speaker-detection model. Its files and device choice are described in
[nemotron-files.md](nemotron-files.md); this guide covers what the code in `nemotron.js` does with them. The worker
(`src/worker.js`) runs it next to the first model and merges the two with `src/engine/combine.js`
([combine-speakers.md](combine-speakers.md)); if the model cannot load or run, the first model's result is used as
before. Tests: `tests/nemotron-features-test.mjs` (front end) and `tests/nemotron-diarize-stub-test.mjs` (segments
from stand-in model output).

Signature: `nemotronDiarize(audio, { ort, embed, step, mel, silence, onProgress })` → `[{ start, end, speaker: 'S0'… }]`.
`audio` is 16 kHz mono `Float32Array`; `ort` is onnxruntime (web or node); `embed` and `step` are inference sessions
(`embed.onnx`, `step_int8.onnx` or a variant); `mel` is `Float32Array [128 × 257]` (`mel_filters.bin`); `silence` is
`Float32Array [512]` (`silence_embeds.bin`). It is ported from the Apache-2.0 `transformers` reference; the same file
is used by the browser worker and the Node measurement tools so what is measured is what ships.

## 1. Front end: `nemotronFeatures(x, mel)` → `{ feats, n }`
1. Pre-emphasis: `y[i] = x[i] − 0.97·x[i−1]`.
2. STFT with a 512-point FFT, hop 160 (10 ms), a symmetric Hann window of 400 samples centred in the 512 window, frames
   centred on a zero-padded signal.
3. Power spectrum (257 bins) → 128 mel bands through the `mel` matrix → `ln(x + 2⁻²⁴)`.
4. `n = floor(samples / 160)` frames, 128 values each. Silence therefore comes out as exactly `ln(2⁻²⁴)`.

## 2. Embeddings
The features go to `embed` as `[1, n, 128]`; the result is `T` encoder frames of 512 values (`T ≈ n / 8`).

## 3. Offline chunk loop
The embeddings are processed in chunks of 340 frames, each with 40 frames of right context, through `step`, which
returns 8 sub-frames × 8 speaker logits per encoder frame. Between chunks a **speaker cache** keeps the most useful
frames so a voice heard early can still be recognised later:
- Frames leave a 40-frame FIFO in blocks of at least 300 and join a cache of at most 264 frames (`cacheLen`).
- When the cache overflows it is compressed: each frame is scored per speaker from its probabilities (probabilities
  below 0.25 are floored; a speaker who has enough confident frames has the weaker ones dropped), frames from the
  newest chunk get +0.05, each speaker's best frames get boosts (the top 75 % of that speaker's share of the cache, then
  the top 150 %), one silence slot is added, and the highest-scoring frames are kept in time order.
- At most **8 speakers** (`K`); `onProgress(end, T)` is called after each chunk.

## 4. Segments
A speaker is "on" for a 10 ms frame when its logit is above 0 (sigmoid above 0.5). Consecutive "on" frames become one
segment with times rounded to 10 ms; there is **no other post-processing** (no minimum length, no gap closing, no
smoothing). Results are sorted by start time and then by speaker label. Overlapping speech gives overlapping segments.

Speaker labels are `S0`…`S7`: the model's own slots, not names. Mapping to "Speaker 1, Speaker 2…" and merging with the
first model happens afterwards.
