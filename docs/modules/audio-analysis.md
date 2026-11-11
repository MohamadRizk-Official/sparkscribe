# Audio analysis and preprocessing (`src/engine/preprocess.js`)

Pure functions on 16 kHz mono `Float32Array` samples. Nothing changes the user's file: the app keeps the original
`File` for playback and saving, and these work on the decoded processing copy. Sample count never changes, so every
timestamp still maps 1:1 to the original recording. Covered by `tests/audio-analysis-test.mjs`.

## `analyzeAudio(samples)`
Real measurements only (echo and overlapping speech are not measured). Works on 30 ms frames (480 samples).

- noise level = 10th percentile of frame loudness, speech level = 90th percentile, SNR = speech minus noise (reported capped at 60 dB).
- speech ratio = share of frames more than 10 dB above noise and above -55 dB.
- clipping = runs of 2 or more samples at 0.999 or above.

| issue | severity | trigger |
|---|---|---|
| Very little speech detected | difficult | speech ratio below 3% |
| Strong background noise / Some background noise | difficult / fair | SNR below 10 dB / below 22 dB |
| Very quiet recording / Quiet recording | difficult / fair | speech level below -45 dB / below -35 dB |
| Heavy distortion / Some distortion (clipping) | difficult / fair | clipped samples above 1% / above 0.1% |

`rating` is the worst severity: `good`, `fair` or `difficult`. Under one frame of audio gives `difficult` with
`Recording is too short` and empty `measured`. `measured` has speechLevelDb, noiseLevelDb, snrDb, peakDb,
clippedPercent and speechPercent.

## `preprocess(samples, analysis)` (in place)
1. Remove DC offset.
2. 70 Hz second-order Butterworth high-pass (rumble below the lowest voice fundamentals).
3. Level normalisation toward about -20 dBFS: gain between -6 and +24 dB, never pushing the 99.95th percentile past about -0.2 dBFS; gains under 0.5 dB are skipped; values above 0.9 are soft-limited with `tanh`.

Returns `{ dcRemoved, highpassHz, gainDb }`. There is deliberately no denoising or spectral subtraction, because it
can smear consonants and make Whisper worse.
