# Word-timing device plan (`src/lib/timing-plan.js`)

`timingPlan(gpu)` returns the `[device, precision]` pairs `align-worker.js` tries, best first:

| GPU situation | Plan |
| --- | --- |
| no `gpu`, no adapter, or `requestAdapter` throws | `[['wasm','fp16']]` |
| adapter with `shader-f16` | `[['webgpu','fp16'], ['wasm','fp16']]` (189 MB model) |
| adapter without `shader-f16` | `[['webgpu','fp32'], ['wasm','fp16']]` (378 MB model) |

The CPU fallback is always last. Test: `tests/timing-plan-test.mjs`.
