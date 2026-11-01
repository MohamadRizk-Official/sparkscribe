// Which word-timing model runs where (align-worker.js), best first. Half precision (189 MB) where the GPU has
// half-precision maths (shader-f16); a GPU without it can't run that model, so there the full-precision one (378 MB)
// runs on the GPU instead; without a usable GPU, half precision on the processor. Each is tried in turn.
export async function timingPlan(gpu) {
  let adapter = null;
  try { adapter = gpu ? await gpu.requestAdapter() : null; } catch { adapter = null; }
  if (!adapter) return [['wasm', 'fp16']];
  return adapter.features?.has('shader-f16') ? [['webgpu', 'fp16'], ['wasm', 'fp16']] : [['webgpu', 'fp32'], ['wasm', 'fp16']];
}
