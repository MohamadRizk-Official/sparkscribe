# Anthropic provider (`server/ai/anthropic.js`)

The only code that calls the Anthropic API; `provider.js` chooses the model and key and hands this module a plain request.
Test: `tests/anthropic-provider-test.mjs` (a stand-in for `fetch`; no network or key).

## `AIError(message, { status = 502, code = 'ai_error' })`
The error type every AI path throws. `server/http.js` `sendError` turns it into the response; any other error becomes a generic 500.

## `anthropicProvider(apiKey)` → `{ name: 'anthropic', complete, stream }`

### Request
`model`, `max_tokens`, `system` and `messages` are always sent. `output_config` is added only when needed: `effort` when given, and `format: { type: 'json_schema', schema }` when a schema is given. `stream: true` is added for streaming. The key travels in the `x-api-key` header only.

### `complete(opts)` → `{ text, json, model, usage }`
- Only `text` blocks are joined. With a schema the text is parsed as JSON into `json`; invalid JSON is an error ("unexpected format"). Without a schema `json` is `null`.
- `stop_reason: 'max_tokens'` → `AIError` code `too_long`; `'refusal'` → code `refused`.
- `model` is the one the service reports, else the one requested.
- `usage`: `input` is **all** prompt tokens (uncached + cache reads + cache writes); `uncached`, `cacheRead`, `cacheWrite` and `output` are reported separately because they are priced differently (cache reads cost 10 % of the input price). Missing usage is zeros.

### Failures and retries (`post`)
| situation | result |
|---|---|
| 429, 500, 502, 503 or 529 on the first try | wait 1.5 s and try once more; if the second try fails too, it is treated like any other error status (below), so two rate limits end as a `503` and the others as a `502` |
| network error | tried twice, then `504` "Could not reach the analysis service." |
| timeout | **never retried** (a second try would not fit the function's time limit and could be billed unseen): `504` "took too long" |
| 401 | `502` "not set up correctly" |
| any other error status | `502` "returned an error" (a 429 is reported as `503`) |
Only the HTTP status and the error *type* are logged; neither the request, the key nor the service's message is ever logged or forwarded.

### `stream(opts, onDelta)` → `{ text, model, usage, truncated }`
Reads server-sent events: `message_start` (model and input usage), `content_block_delta` text pieces (each passed to `onDelta` as it arrives), `message_delta` (stop reason and output tokens). Lines that are not valid JSON are skipped. An `error` event throws a generic `AIError` (the service's own text is never forwarded); a `refusal` throws `refused`; `max_tokens` returns `truncated: true`.
