# Second speaker model files (`src/engine/nemotron-files.js`)

Which files the second speaker model (Nemotron 3 Diarization, ONNX export) needs, where they come from, and which
"step" file runs on which device. Covered by `tests/nemotron-files-test.mjs`.

## Files
`NEMOTRON_FILES` maps a role to `[file name, SHA-256]`: `embed`, `mel`, `silence`, and three step variants:
`stepCpu` (8-bit), `stepGpu` (full precision). The half-precision step has its own list, `NEMOTRON_F16_SOURCES`.
Every download is checked against its SHA-256 (`src/engine/fetch-model.js`). The base URL is pinned to one commit.

## Half-precision sources
Tried in order: SparkScribe's Hugging Face repository, then its Vercel Blob copy. If `VITE_NEMOTRON_F16_BASE` is set it
replaces both (local tests).

## Choosing a step
- `enoughMemory(deviceMemory)`: true when the browser reports at least 4 GB (unknown counts as 8). Below that the first
  speaker model works alone.
- `nemotronGpuSteps(f16, sources, memoryGB)` returns GPU steps best first as `[base, [file, sha], precision]`:
  half-precision sources when the GPU supports shader-f16 and memory ≥ 4 GB, then full precision when memory ≥ 8 GB.
- `nemotronFilesFor(device, f16, memoryGB)` returns the list to download ahead during "Get ready": `embed`, `mel`,
  `silence`, and a final entry for the step. On WebGPU that entry is the list of half-precision alternatives (first that
  works), or the full-precision step when it is the first choice. Otherwise (CPU, or no GPU step allowed) it is the
  8-bit CPU step.
