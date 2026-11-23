# Database store (`server/db.js`)

`supabaseStore(sb)` wraps a Supabase client in the set of queries the AI functions need. `authenticate()` in `server/http.js` builds the client with the **signed-in user's own access token**, so:

- every query runs under Row Level Security as that user: the server can only read and write what the user could;
- the server never chooses `user_id` (the database fills it in);
- no service-role / secret key is used anywhere. The two server secrets (`AI_DB_SECRET`, `BILLING_DB_SECRET`) are not database keys: they are passed as an argument to specific database functions that check them.

This module has no unit test of its own: it needs a database. The behaviour built on top of it is covered through in-memory stores in `tests/service-test.mjs` and `tests/ai-limits-test.mjs`, and the SQL side by `qa/sql/`.

## Errors
`check(error, what)` turns any database error into `AIError("Couldn't <what>.", { status: 500, code: 'db_error' })`. The Supabase message is never copied into it, so nothing from the database reaches the browser. Functions that must not fail the request (`failInsight`, `failArtifact`, `saveQuestion`, `bumpInsightVersion`, `activeAi`) ignore or swallow their error instead.

## Sections
1. Transcripts and insights: below
2. Artifacts (Create tab outputs)
3. Follow-up questions and Ask history
4. AI usage ledger
5. Plan and entitlements
6. Saved Thunder history (`across_items`)

## 1. Transcripts and insights
Columns read are fixed lists (`TRANSCRIPT_COLUMNS`, `INSIGHT_COLUMNS`), so a new database column is never returned by accident.

| function | what it does |
|---|---|
| `getTranscription(id)` | one transcript (id, title, duration, language, recording type, text, segments, content version, created date); `null` when RLS hides it or it is gone |
| `listInsights(transcriptionId)` | every stored insight for the transcript |
| `getInsight(transcriptionId, kind, recordingType)` | the one row for that kind and recording type |
| `startInsight(existing, {…})` | claims a result for generation; see below |
| `finishInsight(id, {content, model, usage})` | `status: 'ready'`, stores content, model and input/output tokens, clears `error` |
| `failInsight(id, message, previousVersion)` | `status: 'failed'`, message cut to **500 characters** |
| `bumpInsightVersion(id, version)` | after a plain speaker rename: a stored result is current for the new version too |

### Claiming a result (`startInsight`)
Two requests may ask for the same result at once. Only one may generate it:
- **Row exists:** it is updated to `generating` with `.eq('updated_at', existing.updated_at)`, so the update only applies if nobody touched the row since it was read. If another request got there first, no row is returned and the function returns `null`.
- **No row:** it is inserted. A unique-violation (`23505`, unique on transcription + kind + recording type) means someone else just inserted it, and the function returns `null`.

A `null` tells the caller another request owns the work.

### Failing keeps the old content
`failInsight` writes only `status`, `error` and (when a version is given) `source_version`; it never touches `content`. A failed regeneration therefore leaves the previous result visible, still tagged with the version it was made for.
`bumpInsightVersion` uses `.lt('source_version', version)`, so it only ever moves a version forward.

## 2. Artifacts (Create tab outputs)
Artifacts (`transcription_artifacts`) follow exactly the same pattern as insights, with two differences: they are keyed by `settings_key` (a normalised form of the user's settings, so different settings are different rows) and they carry a `progress` column.

| function | notes |
|---|---|
| `listArtifacts(transcriptionId)` | all saved tools for the transcript |
| `getArtifact(transcriptionId, kind, settingsKey)` | the row for that kind and settings |
| `startArtifact(existing, {transcriptionId, kind, settings, settingsKey, version})` | same compare-on-`updated_at` claim as `startInsight`; unique violation `23505` returns `null` |
| `finishArtifact(id, {content, model, usage})` | `ready`, content stored, token counts stored, and **`progress` is reset to `null`** |
| `failArtifact(id, message, previousVersion)` | `failed`, message cut to 500 characters, old content kept |

Columns come from `ARTIFACT_COLUMNS`, which includes `settings`, `settings_key` and `progress`.

### `appendFollowups(artifact, items)`
Focused Review adds new practice questions to an existing quiz.
- The new content is `{ ...artifact.content, followups: [...existing followups, ...items] }`: earlier follow-ups are kept, new ones go on the end.
- The update applies only when the row is still `ready` **and** `updated_at` is what the caller read. If the quiz was regenerated or changed meanwhile, `null` is returned and nothing is overwritten.
- Only `content` is written. `progress`, the learner's own state, is left alone.

## 3. Ask history
Table `transcription_questions` holds each question the user asked about a recording.

- `listQuestions(transcriptionId)` reads the **newest 100** (`created_at` descending, limit 100) and then reverses them, so the caller gets them **oldest first**. History shows them in that order; follow-up questions use the last three.
- `findAnswer(transcriptionId, normalized, version, norm)` looks for an earlier identical question. It reads the newest 100 rows **for the same `source_version`** and returns the first whose `norm(question)` equals the already-normalised question, or `null`. The comparison function is passed in by the caller (the service) so the database module has no wording rules of its own. A transcript that was edited (new version) never reuses an answer written for the old text.
- `saveQuestion({…})` stores the question, answer, `refs`, `found`, the version, the model and the token counts and returns `{ id }`. **If saving fails it returns `null` rather than throwing**: the answer was already shown, and failing to keep it is not worth an error.

## 4. AI usage ledger
Used with the SQL in `supabase/proposed/*_ai_usage_limits.sql`. See [ai-usage.md](ai-usage.md) for how costs are estimated and [ai-service.md](ai-service.md) for where the checks sit.

### `reserveAi(feature, estimateMicrousd)`
Called before every model call. It asks the `ai_reserve` database function whether the call is allowed and records a reservation. Possible results:

| situation | result |
|---|---|
| `AI_LIMITS_DISABLED=1` (operator's emergency switch) | `{ allowed: true, id: null, unmetered: true }`; logs once, loudly, that checks are off |
| the database function does not exist (`PGRST202` or `42883`) and `AI_LIMITS_REQUIRED` is not `1` | allowed, unmetered: the rollout fallback before the migration is applied |
| the same, but `AI_LIMITS_REQUIRED=1` | refused: `{ allowed: false, reason: 'unavailable' }` |
| any other error, including a thrown exception (network, timeout) | refused, `reason: 'unavailable'`; only the error code is logged |
| reply is not an object with a boolean `allowed` | refused, `reason: 'unavailable'` |
| a well-formed reply | returned as is |

The guiding rule, from the code comment: **a broken check must never mean unlimited AI.** `feature` is cut to 80 characters and the estimate is coerced to an integer. The server secret is `AI_DB_SECRET`, falling back to `BILLING_DB_SECRET`.

### `activeAi(prefix, withinMs)`
Counts (at most 5) of the user's own ledger rows that are still `reserved` for features starting with `prefix` and were created within the window. It is used to run expensive cross-recording requests one at a time. If the ledger cannot be read it returns `0`: the reservation itself still applies the limits.

### `settleAi(id, ok, {input, output, costMicrousd})`
Replaces the estimate with the real cost through `ai_settle`. It does nothing without both an `id` and a secret. If `AI_LIMITS_REQUIRED=1` but no secret is set, it logs a one-time warning: costs then stay at their estimates, so use is still limited but not exact. A settle error is logged by code only and never thrown.

## 5. Plan and entitlements
`entitlements()` returns the signed-in user's effective plan and the four-tier catalogue:

```js
{ plan, planName, tier, features, plans }
```
- The plan comes from the database function `billing_status`, which works from the subscription Stripe reported. **Nothing the browser sends is read.**
- `plans` are the rows of `billing_plans` that have a tier (`key, name, tier, features`), ordered by tier. It is used to say *which* plan has a missing capability.
- If `billing_status` fails, returns nothing, or `features` is not an array, the function **throws** (`entitlements unavailable: <code>`). Callers refuse rather than guess: `requireCapability` in `server/entitlements.js` turns this into `503 plan_unavailable` ([entitlements.md](entitlements.md)).

## 6. Saved Thunder history (`across_items`)
Answers and study guides made across several recordings. Table `public.across_items`; written **only** through the `across_save` database function with a server secret.

| function | notes |
|---|---|
| `saveAcross({requestId, kind, ids, question, content, sources})` | with no secret (`BILLING_DB_SECRET`, else `AI_DB_SECRET`) returns `{ saved: false, reason: 'unavailable' }`. A database error or empty reply logs the code and returns `{ saved: false, reason: 'error' }`. Otherwise the function's own reply. `requestId` lets the database ignore a repeat of the same request |
| `listAcross({limit = 300})` | light rows only (no content), newest first |
| `acrossItemsFor(ids, {limit = 60})` | items whose `recording_ids` **contain all** of `ids`, with content and sources, newest first. The caller keeps those whose *other* recordings still exist |
| `deleteAcross(id)` | deletes one row; returns `true` only if a row was actually removed |
| `transcriptionTitles(ids)` | `id, title, created_at` for these recordings; `[]` without a query when `ids` is empty |

Reading and deleting use the user's own RLS access, so they work on every plan; saving needs the server secret.
