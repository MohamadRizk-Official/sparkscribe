# Model selection (`server/ai/provider.js`)

One place decides which model does what; nothing else calls an AI API.

## `taskConfig(task)`
Returns `{ model, effort, maxTokens, timeoutMs? }`.

- **Lookup:** the exact task name first (`quiz:verify`), then the first two `:`-separated parts, then the first part, then falls back to the `insights` settings.
- **Model:** the task group's variable, then `AI_MODEL`, then the default `claude-haiku-5-5`.

| variable | tasks |
|---|---|
| `AI_MODEL_SUMMARY` | overview, detailed_summary, notes, reduce |
| `AI_MODEL_INSIGHTS` | insights (and unknown tasks) |
| `AI_MODEL_TOOLS` | study guide, flashcards, quiz (+ verify/recheck), studymap, definitions, exam points, meeting recap, action plan, emails, replies, interview Q&A, episode notes, `across:guide`, grade |
| `AI_MODEL_ASK` | ask, `across:ask`, expand |

- **effort** is `low` for quick lookups (ask, expand, grade, reply_draft) and `medium` otherwise. `maxTokens` includes thinking, so it is a ceiling.
- **timeoutMs** exists only for long or checking tasks (flashcards/quiz 170 s, studymap 120 s, verify 75 s, recheck 45 s, `across:ask` 50 s, `across:guide` 170 s).

## `getProvider()`
- `AI_PROVIDER=mock` returns the local mock provider, **except** when `VERCEL_ENV=production` (then it is ignored).
- Otherwise `ANTHROPIC_API_KEY` is required; without it the call throws `AIError` 503 `not_configured`.
- The provider is created once and cached.

Covered by `tests/provider-test.mjs`.
