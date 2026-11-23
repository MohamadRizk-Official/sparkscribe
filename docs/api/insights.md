# `/api/insights`

Source: `api/insights.js`. Reads and generates the per-recording AI results (summary, key points and similar). Logic lives in `getState` and `generate` in `server/ai/service.js`.

## `GET /api/insights?transcriptionId=<uuid>`
Returns everything already generated for the transcript. **No AI call is made**, so it is safe to call on every page load. The id is taken from the query string; if it is not a UUID the answer is `400 bad_request` "Invalid transcript."

## `POST /api/insights`
```json
{ "transcriptionId": "<uuid>", "kind": "…", "recordingType": "…", "force": true }
```
- `kind` is coerced to a string (`String(body.kind || '')`); unknown kinds are rejected by the service, not here.
- `force` only counts when it is exactly `true`; any other value is treated as "use the stored result if it is still current".
- The signed-in user's id is passed along so the usage limits (see [../modules/ai-usage.md](../modules/ai-usage.md)) apply to the right person.

## Other methods
Anything else answers `405` with `Allow: GET, POST` and `{ "error": "method_not_allowed" }`.

## Errors
All errors go through `sendError`: an `AIError` keeps its status, code and message; any other error is a generic 500 `server_error`.
