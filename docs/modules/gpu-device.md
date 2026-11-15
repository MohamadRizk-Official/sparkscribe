# Own GPU device (`src/engine/gpu-device.js`)

`ownGpuDevice()` requests a separate WebGPU device for models that run once per recording inside the transcription
worker: the second speaker model and the word timing used for speaker splits.

- Returns `null` when there is no WebGPU adapter.
- Otherwise requests a device with **every feature and every numeric limit the adapter offers**; the runtime uses what
  it needs.
- Destroying the device afterwards returns all of its GPU memory. On the device Whisper uses, the runtime keeps freed
  buffers pooled, which is why these models get their own.
- It is deliberately not a separate Web Worker: a third copy of the runtime in one page made the browser hold 2–3 GB
  more for a while (PROTOCOL.md addenda 9 and 10).

Needs a browser; it reads `self.navigator.gpu`, so it is not unit-tested under plain Node.
