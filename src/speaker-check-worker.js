// The second speaker model (engine/nemotron.js) in a worker of its own: the transcription worker (worker.js) starts it
// for one recording and ends it straight after, so everything it loaded (its sessions and their GPU buffers) is freed.
// Released inside the transcription worker, the runtime kept those GPU buffers pooled and the GPU held 1-4 GB more
// while Whisper ran (PROTOCOL.md addendum 9). Which step file runs where: engine/nemotron-files.js.
//   in:  { type: 'run', audio: Float32Array (16 kHz mono), dev: 'webgpu' | 'wasm', f16: boolean, wasmPaths }
//   out: { type: 'progress', … } (downloads) | { type: 'run-progress', done, total }
//        | { type: 'done', segments, device, precision } | { type: 'failed', message }
import * as ort from 'onnxruntime-web/webgpu';
import { nemotronDiarize } from './engine/nemotron.js';
import { cachedModel } from './engine/fetch-model.js';
import { NEMOTRON_BASE, NEMOTRON_FILES, NEMOTRON_F16_SOURCES, nemotronGpuSteps } from './engine/nemotron-files.js';

async function load(dev, f16, onProgress) {
  const get = ([name, sha], base = NEMOTRON_BASE) => cachedModel(base + name, sha, { onProgress });
  const f32 = (buf) => new Float32Array(buf);
  const [embedBuf, mel, silence] = await Promise.all([get(NEMOTRON_FILES.embed), get(NEMOTRON_FILES.mel).then(f32), get(NEMOTRON_FILES.silence).then(f32)]);
  if (dev === 'webgpu') {
    for (const [base, file, precision] of nemotronGpuSteps(f16, NEMOTRON_F16_SOURCES, self.navigator?.deviceMemory || 8)) {
      let stepBuf;
      try { stepBuf = await get(file, base); } catch (err) { console.warn(`Second speaker model (${precision}) could not be downloaded:`, err); continue; }
      try {
        const opts = { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' };
        return { embed: await ort.InferenceSession.create(new Uint8Array(embedBuf), opts), step: await ort.InferenceSession.create(new Uint8Array(stepBuf), opts), mel, silence, device: 'webgpu', precision };
      } catch (err) {
        // most likely not enough GPU memory: a bigger step won't fit either, so the processor's 8-bit step instead
        console.warn(`Second speaker model (${precision}) on the GPU failed:`, err);
        break;
      }
    }
  }
  const stepBuf = await get(NEMOTRON_FILES.stepCpu);
  const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  return { embed: await ort.InferenceSession.create(new Uint8Array(embedBuf), opts), step: await ort.InferenceSession.create(new Uint8Array(stepBuf), opts), mel, silence, device: 'wasm', precision: 'int8' };
}

self.onmessage = async ({ data }) => {
  if (data?.type !== 'run') return;
  try {
    if (data.wasmPaths) ort.env.wasm.wasmPaths = data.wasmPaths; // the same runtime files the transcription worker uses
    ort.env.wasm.numThreads = 1;
    const m = await load(data.dev, data.f16, (p) => self.postMessage({ type: 'progress', ...p }));
    const segments = await nemotronDiarize(data.audio, { ort, ...m, onProgress: (done, total) => self.postMessage({ type: 'run-progress', done, total }) });
    self.postMessage({ type: 'done', segments, device: m.device, precision: m.precision });
  } catch (err) {
    self.postMessage({ type: 'failed', message: String(err?.message || err) });
  }
};
