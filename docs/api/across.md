# `POST /api/across`

Source: `api/across.js`. Questions and study guides across several of a user's recordings (the "Thunder" plan). Logic is in `server/ai/across.js` and `server/ai/service.js`.

`POST` only. The body's `ids` is read as an array and cut to the first **50** entries; anything that is not an array is `[]`.

| `action` | returns |
|---|---|
| `status` | `{ recordings: [{ label, id, title, createdAt, duration, hasSummary, hasMap }], limits }` |
| `ask` | Server-Sent Events: `names`, `status`, `delta`, `done`, `error` |
| `guide` | `{ item, saved }`, or `409 needs_maps` with `details.needs` listing recordings to prepare first |
| `history` | `{ sets }`: the selections that have saved work, newest first |
| `thread` | `{ items }`: saved answers and guides for this selection, newest first |
| `delete` | `{ deleted: true }` |
| anything else | `400 bad_request` "Unknown action." |

`guide` takes `focus`: only the exact string `"exam"` selects the exam focus; everything else is `"balanced"`. `ask` and `guide` also take a `requestId` (used to save the result once).

## Plan checks
Asking and creating guides need Thunder. The check runs on the server before anything is read (`403 plan_required`). Saved work stays readable and deletable on every plan.

## Streaming only when the answer is ready to stream
For `ask`, the SSE headers are sent lazily, by `begin()`, on the first event (or just before `done`). Everything that can fail before the model runs, the plan check above all, therefore comes back as a plain JSON error with a real status code. After streaming has begun, errors are sent as an `error` event and include `details` when the `AIError` carries them.

## Row Level Security
Every recording is read as the signed-in user, so ids that are not theirs simply do not exist: `404` with `details.missing`.
