// The second speaker model's files (Nemotron 3 Diarization, NVIDIA, OpenMDW-1.1; ONNX export NealCaren/
// Nemotron-3-Diarization-ONNX at a pinned commit), each checked by SHA-256 when downloaded (engine/fetch-model.js), and
// which step file runs on which device. Shared by the transcription worker (which only makes sure they are downloaded,
// during "Get ready") and the speaker-check worker (which loads and runs them).
//
// The step, by device (PROTOCOL.md addenda 9 and 9b): on a GPU with half-precision maths (shader-f16) the half-precision
// step (199 MB instead of 396 MB; made by scripts/nemotron-fp16.py, hosted by SparkScribe on Vercel Blob with the
// model's LICENSE and NOTICE beside it); the full-precision one only where that file can't be downloaded or the GPU has
// no half-precision maths, and only in a computer with 8 GB of memory or more; otherwise, and whenever a GPU step fails
// to load (not enough GPU memory), the 8-bit step on the processor (the one tested for computers without a GPU).
export const NEMOTRON_BASE = 'https://huggingface.co/NealCaren/Nemotron-3-Diarization-ONNX/resolve/46642c09b3bd014c5ceb19d20524fa2f1dc27dee/';
export const NEMOTRON_FILES = {
  embed: ['embed.onnx', '2e8796e42286abe2e2d7d44a97fab7e5a7d06b2d4cbee82a3a0f730cfff84a33'],
  stepCpu: ['step_int8.onnx', '1f18a5aed4909677d3618c9e6ed6e3003720b6d6e766f0f8b337aa4fcb0a9d2a'],
  stepGpu: ['step.onnx', 'cd7fa5b062e0cbcd8c43e27627eb7fb305e5bce3ec4faa89d8ff8d8879bae82f'],
  mel: ['mel_filters.bin', 'bce5ec5f194a5913f6508cee5a85512e7bad2352db8fc28f5c6ff75af8b09137'],
  silence: ['silence_embeds.bin', 'd4417b3c0eabdf7c47032fac2b5b5a7ee83d819a6ddda8fd8eaf74e2b5cc4ac7'],
};
export const NEMOTRON_F16_BASE = import.meta.env?.VITE_NEMOTRON_F16_BASE ?? 'https://w5aulmrlwl9althj.public.blob.vercel-storage.com/nemotron-3-diarization/fp16-ae823473/';
export const NEMOTRON_F16 = [import.meta.env?.VITE_NEMOTRON_F16_BASE ? 'step_fp16.onnx' : 'step_fp16-FYjtTpNzIhrZr8m9n9MUhMaRCstm2N.onnx', 'ae823473c08de435a19b29a48c6dd0dde167f9130eee107e7fa83fd2fe219d04'];

// GPU steps to try, best first: [base, [file, sha256], precision]
export function nemotronGpuSteps(f16, f16Base = NEMOTRON_F16_BASE, memoryGB = 8) {
  const steps = [];
  if (f16 && f16Base && memoryGB >= 4) steps.push([f16Base, NEMOTRON_F16, 'fp16']);
  if (memoryGB >= 8) steps.push([NEMOTRON_BASE, NEMOTRON_FILES.stepGpu, 'fp32']);
  return steps;
}

// the files a device will use first: [url, sha256] (downloaded ahead, during "Get ready")
export function nemotronFilesFor(dev, f16, memoryGB = 8) {
  const at = ([name, sha], base = NEMOTRON_BASE) => [base + name, sha];
  const gpu = dev === 'webgpu' ? nemotronGpuSteps(f16, NEMOTRON_F16_BASE, memoryGB)[0] : null;
  return [at(NEMOTRON_FILES.embed), at(NEMOTRON_FILES.mel), at(NEMOTRON_FILES.silence), gpu ? at(gpu[1], gpu[0]) : at(NEMOTRON_FILES.stepCpu)];
}
