// Which word-timing model runs where (src/lib/timing-plan.js).   node tests/timing-plan-test.mjs
import assert from 'node:assert/strict';
import { timingPlan } from '../src/lib/timing-plan.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const gpu = (features) => ({ requestAdapter: async () => (features ? { features: new Set(features) } : null) });
const first = async (g) => (await timingPlan(g))[0].join(' ');

ok((await first(gpu(['shader-f16']))) === 'webgpu fp16', 'a GPU with half-precision maths: the half-precision model on the GPU');
ok((await first(gpu([]))) === 'webgpu fp32', 'a GPU without it: the full-precision model on the GPU, not the slow processor');
ok((await first(gpu(null))) === 'wasm fp16', 'WebGPU but no usable GPU: the half-precision model on the processor');
ok((await first(undefined)) === 'wasm fp16', 'no WebGPU at all: the processor');
ok((await first({ requestAdapter: async () => { throw new Error('lost'); } })) === 'wasm fp16', 'asking for a GPU fails: the processor');
ok((await timingPlan(gpu(['shader-f16']))).at(-1).join(' ') === 'wasm fp16', 'if the GPU model fails to load, the processor is tried next');

console.log(`\n${pass} checks passed`);
