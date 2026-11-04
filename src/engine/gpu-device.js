// A GPU device of its own for a model that runs once per recording inside the transcription worker (worker.js): the
// second speaker model (engine/speaker-check.js) and the word timing for speaker splits (engine/word-timing.js).
// Destroying it afterwards gives all its GPU memory back; on the device Whisper uses, the runtime keeps freed buffers
// pooled (PROTOCOL.md addendum 9). Not a worker of its own: a third copy of the runtime in one page made the browser
// hold 2-3 GB more for a while (addendum 10). Asks for everything the adapter offers; the runtime uses what it needs.
// -> GPUDevice | null (no GPU)
export async function ownGpuDevice() {
  const adapter = await self.navigator?.gpu?.requestAdapter();
  if (!adapter) return null;
  const requiredLimits = {};
  for (const k in adapter.limits) if (typeof adapter.limits[k] === 'number') requiredLimits[k] = adapter.limits[k];
  return adapter.requestDevice({ requiredFeatures: [...adapter.features], requiredLimits });
}
