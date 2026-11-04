// The second speaker model (engine/nemotron.js), run inside the transcription worker (worker.js) with the runtime it
// already has, on a GPU device of its own that is destroyed straight after (engine/gpu-device.js). Which step file runs
// where: engine/nemotron-files.js.
//   runSpeakerCheck(audio, { dev, f16, onProgress, onRunProgress }) -> { segments, device, precision }; throws if it
//   can't load or run (the caller keeps the first model's result)
import * as ort from 'onnxruntime-web/webgpu';
import { nemotronDiarize } from './nemotron.js';
import { cachedModel } from './fetch-model.js';
import { ownGpuDevice } from './gpu-device.js';
import { NEMOTRON_BASE, NEMOTRON_FILES, NEMOTRON_F16_SOURCES, nemotronGpuSteps } from './nemotron-files.js';

async function load(dev, f16, onProgress) {
  const get = ([name, sha], base = NEMOTRON_BASE) => cachedModel(base + name, sha, { onProgress });
  const f32 = (buf) => new Float32Array(buf);
  const [embedBuf, mel, silence] = await Promise.all([get(NEMOTRON_FILES.embed), get(NEMOTRON_FILES.mel).then(f32), get(NEMOTRON_FILES.silence).then(f32)]);
  if (dev === 'webgpu') {
    for (const [base, file, precision] of nemotronGpuSteps(f16, NEMOTRON_F16_SOURCES, self.navigator?.deviceMemory || 8)) {
      let stepBuf;
      try { stepBuf = await get(file, base); } catch (err) { console.warn(`Second speaker model (${precision}) could not be downloaded:`, err); continue; }
      const m = { gpu: null, embed: null, step: null };
      try {
        m.gpu = await ownGpuDevice();
        if (!m.gpu) break;
        const opts = { executionProviders: [{ name: 'webgpu', device: m.gpu }], graphOptimizationLevel: 'all' };
        m.embed = await ort.InferenceSession.create(new Uint8Array(embedBuf), opts);
        m.step = await ort.InferenceSession.create(new Uint8Array(stepBuf), opts);
        return { ...m, mel, silence, device: 'webgpu', precision };
      } catch (err) {
        // most likely not enough GPU memory: a bigger step won't fit either, so the processor's 8-bit step instead
        console.warn(`Second speaker model (${precision}) on the GPU failed:`, err);
        await free(m);
        break;
      }
    }
  }
  const stepBuf = await get(NEMOTRON_FILES.stepCpu);
  const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  const m = { gpu: null, embed: null, step: null };
  try {
    m.embed = await ort.InferenceSession.create(new Uint8Array(embedBuf), opts);
    m.step = await ort.InferenceSession.create(new Uint8Array(stepBuf), opts);
    return { ...m, mel, silence, device: 'wasm', precision: 'int8' };
  } catch (err) { await free(m); throw err; }
}

// the sessions released, then the model's own GPU device destroyed (never the one Whisper uses)
async function free(m) {
  for (const s of [m.embed, m.step]) { try { await s?.release(); } catch { /* gone with the device anyway */ } }
  try { m.gpu?.destroy(); } catch { /* already lost */ }
}

export async function runSpeakerCheck(audio, { dev, f16, onProgress = () => {}, onRunProgress = () => {} }) {
  const m = await load(dev, f16, onProgress);
  try {
    const segments = await nemotronDiarize(audio, { ort, ...m, onProgress: onRunProgress });
    return { segments, device: m.device, precision: m.precision };
  } finally {
    await free(m);
  }
}
