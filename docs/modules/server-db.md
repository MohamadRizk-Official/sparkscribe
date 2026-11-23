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
