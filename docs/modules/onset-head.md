# Word-onset head (`src/lib/onset-head.js`)

A tiny neural network that scores, for every 20 ms frame of audio, "does a word start here?". The alignment worker
uses the scores to move word start times to the real onset (so clicking a sentence plays from its first word, not
from the middle of a drawn-out one). Test: `tests/onset-test.mjs` (arithmetic and refinement) and
`tests/onset-head-shape-test.mjs` (float16 decoding, size check, output shape).

## Where it runs
- `src/align-worker.js` loads the weights from `/models/onset-head-v1.bin` (a plain fetch; if the file is missing or
  malformed the worker carries on without it, `null` head → no refinement).
- It feeds `onsetScores` the hidden features of the word-timing model (wav2vec2-base-960h, layer 8, 768 values per
  frame) and passes the result to `refineStarts` in `src/lib/ctc-align.js`.
- Everything is plain JavaScript over typed arrays: no ONNX, no WebGPU. It costs a fraction of a second per paragraph.

## Shape of the network
| step | size |
|---|---|
| input | `frames × 768` hidden features (`Float32Array`, or `Uint16Array` holding float16) |
| projection + GELU | 768 → 96 (`W1` `[96×768]`, `b1` `[96]`; the input normalisation is folded into `W1`) |
| convolution 1 + GELU | 96 → 64 channels, 9 frames wide, zero padding (`C1`, `c1`) |
| convolution 2 | 64 → 1, 5 frames wide, zero padding (`C2`, `c2`) → one logit per frame |

The exported constants `HIDDEN`, `P`, `C`, `K1`, `K2` are these sizes; `WEIGHT_COUNT` is the total number of weights
(about 130 000).

## The weight file
`loadOnsetHead(bytes)` expects an `ArrayBuffer` of exactly `WEIGHT_COUNT` float16 values, little-endian, in the order
`W1, b1, C1, c1, C2, c2`. Any other length throws `onset head: N weights, expected M`. Values are widened to
`Float32Array` once, at load time, and the tensors are returned as views onto one buffer.

## Details worth knowing
- `halfToFloat` decodes IEEE half precision by hand, including subnormals, ±Infinity and NaN.
- GELU is the exact form (as PyTorch's default), with `erf` from the Abramowitz & Stegun 7.1.26 approximation
  (error below 1.5e-7).
- The output is a **logit**, not a probability. Callers compare scores to a threshold (`ONSET_SETTINGS` in
  `src/lib/ctc-align.js`).
- With all-zero weights every frame scores exactly `c2[0]`, the final bias. That makes the head easy to test without
  real weights.
- The head was trained on human word times from AMI meetings. The source comment cites a protocol write-up (addendum 4 of
  `accuracy/research/speaker-2026-10-30/PROTOCOL.md`); that file is not in this repository.
