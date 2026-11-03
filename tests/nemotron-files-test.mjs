// Which second-model files a device uses (src/engine/nemotron-files.js): half precision first on GPUs that can run it,
// full precision only with plenty of memory, the processor's 8-bit step otherwise; nothing under 4 GB.
//   node tests/nemotron-files-test.mjs
import assert from 'node:assert/strict';
import { nemotronGpuSteps, nemotronFilesFor, enoughMemory, NEMOTRON_F16_SOURCES } from '../src/engine/nemotron-files.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

ok(!enoughMemory(2) && !enoughMemory(0.5) && enoughMemory(4) && enoughMemory(8) && enoughMemory(undefined), 'under 4 GB the second model is skipped; unknown memory counts as enough');
const p8 = nemotronGpuSteps(true, NEMOTRON_F16_SOURCES, 8).map((s) => s[2]);
ok(p8.join() === 'fp16,fp16,fp32', 'GPU with half-precision maths, 8 GB: Hugging Face copy, then Blob copy, then full precision');
ok(nemotronGpuSteps(true, NEMOTRON_F16_SOURCES, 8)[0][0].startsWith('https://huggingface.co/'), 'the Hugging Face copy comes first');
ok(nemotronGpuSteps(true, NEMOTRON_F16_SOURCES, 4).map((s) => s[2]).join() === 'fp16,fp16', '4 GB: half precision only (never the 396 MB file)');
ok(nemotronGpuSteps(false, NEMOTRON_F16_SOURCES, 4).length === 0, 'GPU without half-precision maths and under 8 GB: no GPU step (the processor runs it)');
ok(nemotronGpuSteps(false, NEMOTRON_F16_SOURCES, 8).map((s) => s[2]).join() === 'fp32', 'GPU without half-precision maths, 8 GB: full precision');
const ahead = nemotronFilesFor('webgpu', true, 8);
ok(Array.isArray(ahead[3][0]) && ahead[3].length === 2 && ahead[3].every(([u]) => /step_fp16/.test(u)), 'downloaded ahead on a GPU: the half-precision step, from the first copy that works (not the full-precision one)');
ok(/step_int8\.onnx$/.test(nemotronFilesFor('wasm', false, 8)[3][0]), 'downloaded ahead without a GPU: the 8-bit step');
ok(new Set(NEMOTRON_F16_SOURCES.map((s) => s[1][1])).size === 1, 'every half-precision copy is checked against the same SHA-256');

console.log(`\n${pass} checks passed`);
