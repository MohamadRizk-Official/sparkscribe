# Second speaker check runner (`src/engine/speaker-check.js`)

`runSpeakerCheck(audio, { dev, f16, onProgress, onRunProgress })` → `{ segments, device, precision }`. It runs the second
speaker model (`engine/nemotron.js`) inside the transcription worker on a GPU device of its own
(`engine/gpu-device.js`). It throws if the model cannot load or run, and the caller keeps the first model's result.

## Loading order (`load`)
1. Download (checksum-verified, cached) `embed`, `mel`, `silence`.
2. On `webgpu`: for each step from `nemotronGpuSteps(f16, sources, deviceMemory||8)`, download it (a failed download
   moves to the next candidate), create an own GPU device and both sessions. If there is no GPU device, stop trying GPU.
   If session creation fails (usually not enough GPU memory) free everything and **stop** GPU attempts — a bigger step
   would not fit either.
3. Fallback: the 8-bit CPU step on `wasm` (`precision: 'int8'`).

## Cleanup
`free` releases both sessions and destroys the model's own GPU device (never Whisper's). `runSpeakerCheck` always
frees in a `finally`.

Needs `onnxruntime-web` and a browser worker, so it is not covered by plain-Node tests. File list and step choice:
`docs/modules/nemotron-files.md`.
