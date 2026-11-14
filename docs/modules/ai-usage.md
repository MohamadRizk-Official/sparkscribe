# AI usage log and cost estimate (`server/ai/usage.js`)

Every AI request is recorded as one JSON line in the server log, prefixed `[ai-usage] `. Covered by `tests/usage-cost-test.mjs` and `tests/usage-meter-test.mjs`.

Never logged: prompts, transcript text, answers, API keys.

## `estimateCost(model, usage)`
USD for one call, from a price table in US dollars per million tokens:

| model | uncached in | cache write | cache read | out |
|---|---|---|---|---|
| `claude-haiku-5-5` | 0.10 | 0.125 | 0.01 | 0.50 |
| `claude-haiku-5-5`, prompt over 100k tokens | 0.50 | 0.625 | 0.05 | 2.50 |
| `claude-sonnet-5-5` | 2 | 2.5 | 0.10 | 10 |
| `claude-opus-5-5` | 4 | 5 | 0.20 | 20 |

- `usage` is `{ uncached, cacheWrite, cacheRead, output }`; missing fields count as 0.
- The prompt size for the long-prompt tier is `uncached + cacheWrite + cacheRead`. Exactly 100,000 is still the normal tier. The long rates then apply to the whole call.
- The model is matched by exact id, then by prefix (so a dated id works). An unknown or missing model returns `null`.
- The result is rounded to 7 decimal places.

## `createMeter({ feature, transcriptionId, userId })`
One meter per user action (for example "generate the notes").
- `call(task, fn)` runs one provider call, measures latency and records the tokens. A rejected call is recorded as `failed` with zero tokens and the error is rethrown.
- `finish({ groundingPassed, droppedItems, cached, error })` writes one line per call, with `estimatedCostUsd` (`actualCostUsd` is always `null`: the API reports tokens, not money). When the action was answered from storage and made no calls, one zero-cost `cached: true` line is written instead.
- `refused(reason)` writes one zero-token line for a request that was turned away.
- `slot` and `onSettle` are the AI usage ledger reservation (`service.js`). `finish()` settles it once, with success (`!error`) and the real totals (`input`, `output`, `costMicrousd`), and clears `slot`. A failing settle never throws.

## Local file
`AI_USAGE_LOG=<file>` also appends the lines to a file. It is ignored when `VERCEL` is set, and a write error never breaks a request.
