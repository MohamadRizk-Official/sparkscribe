# Server request helpers (`server/http.js`)

Small helpers shared by every API function; they behave the same on Vercel Node functions and the Vite dev server. Tests:
`tests/http-test.mjs` (body reading, deployment origin) and `tests/http-helpers-test.mjs` (the rest).

| function | behaviour |
|---|---|
| `readJson(req)` | Reads the JSON body. Accepts a body the platform already parsed (object, string or nothing) and a raw stream. The size limit is **16 KB** and applies to every path: over it, `413 bad_request` "Request too large."; text that is not JSON, `400 bad_request` "Invalid request."; an empty body is `{}`. |
| `sendJson(res, status, body)` | Writes the status and the body as UTF-8 JSON with `Cache-Control: no-store`. |
| `sendError(res, err)` | An `AIError` keeps its status, code and message (and `details` when the caller set them: small, user-safe facts such as which recordings are gone). **Any other error is a 500 `server_error`** with the generic message "Something went wrong. Try again."; only the error's *name* is logged, so a message that contains a token never reaches the client or the log. |
| `isUuid(s)` | Strict 8-4-4-4-12 hex check, any case; non-strings are false. Used to validate ids before they reach the database. |
| `deploymentOrigin(env)` | This deployment's own address from Vercel's environment, never from the request: production uses `VERCEL_PROJECT_PRODUCTION_URL`, otherwise `VERCEL_BRANCH_URL` then `VERCEL_URL`; `null` locally. Sent as `x-sparkscribe-origin` so database settings scoped to an origin apply to server calls too. |
| `isRecoveryToken(token)` | Reads the token's claims (not verified here; Supabase has verified it) and is true when the **newest** sign-in method (`amr`) is `recovery`. A password sign-in after the reset link makes it false. Unreadable tokens are false. |
| `authenticate(req)` | Who is calling? See below. |

## `authenticate(req)`
1. Local dev only: with `SPARKSCRIBE_DEV_HARNESS=1`, a harness installed by the dev server and an `x-dev-harness: 1` header, the in-memory store is used. Never on Vercel (`VERCEL` is always set there).
2. No Supabase URL or key configured: `503 not_configured`.
3. No `Authorization: Bearer …` header: `401 unauthorized` "Sign in to use this."
4. Supabase Auth verifies the token (`getUser`); failure is `401` "Your session has expired. Sign in again."
5. A password-reset session (`isRecoveryToken`) is refused with `403 recovery_session`: it exists only to choose a new password.
6. Returns `{ user: { id }, db }`, where `db` queries **as that user**, so row-level security decides what exists for them.
