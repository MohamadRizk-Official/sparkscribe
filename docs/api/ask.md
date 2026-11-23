# `POST /api/ask`

Source: `api/ask.js`. Answers one question about one transcript and streams the answer back as Server-Sent Events. The work itself is `askTranscript` in `server/ai/service.js` (see [../modules/ai-service.md](../modules/ai-service.md)).

## Request
```json
{ "transcriptionId": "<uuid>", "question": "…", "at": 123.4 }
```
- `transcriptionId` must be a UUID (`isUuid`), otherwise `400 bad_request` "Invalid transcript."
- `at` is the current playback position in seconds, used for "explain this part". It is passed on only if it is a finite number `>= 0`; anything else becomes `null`.
- Any method other than `POST` is `405 method_not_allowed`.

## Order of work
1. `authenticate(req)` verifies the token and builds a database store that queries as that user (Row Level Security decides what exists).
2. The JSON body is read (16 KB limit).
3. The id is validated.
4. **Only now** are the SSE headers sent (`text/event-stream`, `no-cache, no-transform`, `X-Accel-Buffering: no`) and the status becomes 200.

Because headers are sent last, every failure before step 4 (not signed in, bad id, body too large) is an ordinary JSON error with the right HTTP status, not a stream.

## Events
| event | data |
|---|---|
| `status` | `{ status: "searching" \| "answering" }` |
| `delta` | `{ text }`: answer text as it is written |
| `done` | `{ id, answer, refs, found, unsupported, cached }` |
| `error` | `{ error, message }` |

## Errors after the stream has started
Once streaming, the HTTP status can no longer change, so a failure is sent as an `error` event and the stream is ended. A known `AIError` sends its own `code` and `message`; anything else is logged by *name only* and sent as `server_error` with "The answer couldn't be generated. Try again."
