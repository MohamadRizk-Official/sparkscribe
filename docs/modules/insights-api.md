# Browser client for the intelligence API (`src/insights/api.js`)

Thin wrappers over `fetch` for `/api/insights`, `/api/ask`, `/api/across` and `/api/tools`. The browser holds no AI keys:
every request carries the signed-in user's Supabase access token (`Authorization: Bearer …`) and the server verifies it.
Tested without an account by `tests/insights-api-unconfigured-test.mjs`.

## Errors
`ApiError(message, code, status)` is the only error type callers see.

- No session (or Supabase not configured) → the request is never sent. Because the missing session surfaces while the headers are being built, it is reported like any failed connection: `code: 'network'`, `status: 0`, "Couldn't reach SparkScribe. Check your connection." (`headers()` itself throws `unauthorized` / 401 "Sign in to use this." when Supabase is configured but there is no token, but the callers' `catch` re-throws that one as is.)
- `fetch` fails → `network` / 0.
- HTTP error → the server's `message`, `error` (as `code`) and status; `Request failed (N).` when the body has no message. JSON calls and the Across stream also attach the server's `details` (for example which recordings are gone).

## Calls
| function | endpoint | notes |
|---|---|---|
| `fetchState(id)` | `GET /api/insights?transcriptionId=` | stored insights for a recording |
| `requestInsight(id, kind, recordingType, force)` | `POST /api/insights` | generate or fetch an overview, summary, notes or insights |
| `askQuestion(id, question, at, { onStatus, onDelta })` | `POST /api/ask` | server-sent events; resolves with the final grounded answer |
| `acrossStatus / acrossGuide / acrossHistory / acrossThread / acrossDelete` | `POST /api/across` | `action` selects the operation |
| `askAcross(ids, question, requestId, handlers)` | `POST /api/across` (`action: 'ask'`) | streams like `askQuestion`, plus `onNames` |
| `gradeAnswer`, `requestFollowups`, `prepareStudyMap`, `requestTool` | `POST /api/tools` | Practice Quiz grading, Focused Review follow-ups, study-map preparation, Create tab outputs |

## Streams
Both stream readers split the response on blank lines and read `event:` / `data:` pairs: `delta` (text to append),
`status` (`searching` or `answering`), `names` (Across only), `done` (the result) and `error`. If the stream ends with no
`done`, the call fails with `incomplete`. A stream that breaks mid-way fails with a `network` error saying the connection
dropped before the answer was complete.
