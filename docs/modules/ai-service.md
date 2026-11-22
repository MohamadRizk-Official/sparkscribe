# AI service (`server/ai/service.js`)

The orchestration layer for everything built on a saved transcript: overview, summaries, notes, insights, Ask, the Create
tools (study guide, flashcards, quiz, …), follow-ups, grading and Across. It decides **when** the model is called and
**what is reused**; the model call itself is [ai-provider.md](ai-provider.md), prompts are in [prompts.md](prompts.md),
and grounding of the output is in [grounding.md](grounding.md). Written from the code. Constants and the pure helpers
are covered by `tests/service-test.mjs`, `tests/service-constants-test.mjs`, `tests/ai-limits-test.mjs`.

## Cost rules (from the file header)
1. A result is generated **once** per (transcript version, kind, recording type or settings) and then read from the
   database. Nothing regenerates unless the transcript changed or the user asks (`force`).
2. Concurrent requests for the same result share one generation instead of starting another. A row stuck in
   `generating` can be taken over only after the first request could no longer be running:
   `INSIGHT_TAKEOVER_MS` = 75 s (insights and Ask run at most 60 s) and `ARTIFACT_TAKEOVER_MS` = 310 s (Create tools run
   at most 300 s), both bounded by `vercel.json`.
3. Every prompt stays under about 90k tokens (Haiku's cheaper band): `PART_TOKENS` = 80 000 per part; longer transcripts
   are analysed in parts and the partial results merged (`parts()`, `analyze()`).
4. Ask sends only the relevant excerpts of a long transcript, and a repeated question is answered from the stored answer.
5. A transcript over `MAX_TRANSCRIPT_TOKENS` (600 000, about 30+ hours of speech) is refused (422 `too_long`) rather
   than analysed.

## Exports
| export | purpose |
|---|---|
| `getState(db, id)` | everything already generated (insights, stored Ask answers, artifacts) with **no model calls**; the internal `study_map` row is never listed |
| `generate(db, {transcriptionId, kind, recordingType, force, userId})` | one of `KINDS` = overview, detailed summary, notes, insights |
| `generateArtifact(db, {transcriptionId, kind, settings, force, userId})` | one Create tool with its settings |
| `prepareStudyMap(db, {transcriptionId, userId})` | builds the study map ahead of time (key `STUDY_MAP_KEY` = `g2`) when the Create tab opens; does nothing, and reserves nothing, if a current map exists or one is being built |
| `gradeShortAnswer(db, …)` | grades a quiz short answer by meaning |
| `generateFollowups(db, …)` | follow-up questions for weak concepts, at most `MAX_FOLLOWUPS` = 30 per quiz |
| `askTranscript(db, …, emit)` | grounded Q&A with timestamp citations, streamed through `emit` |
| `askAcrossRecordings`, `guideAcrossRecordings` | Thunder features, see [across-guide.md](across-guide.md) |
| `estimateMicrousd(feature, promptTokens)` | the reservation estimate, see below |
| `gradePromptFields(q, lines, given)` | bounds every field of the grader prompt, see below |

## Per-user AI limits
Before any action that reaches the model, `reserveAi` asks the database for a **slot** (`db.reserveAi`) using an
estimate of the cost; it is settled afterwards with the real tokens and cost (`db.settleAi`). Cached results never
reserve. Without the database functions everything runs unlimited, as before. Refusals become `AIError`s:

| slot reason | status | code | message idea |
|---|---|---|---|
| `paused` | 503 | `ai_paused` | the service-wide daily breaker tripped; transcription still works |
| `unavailable` | 503 | `ai_unavailable` | "briefly unavailable. Nothing was used" |
| `hourly` | 429 | `rate_limited` | try again in about N minutes (default 10 when the database gives none) |
| anything else | 429 | `quota_exceeded` | the plan's monthly allowance is used; names the renewal date (UTC) |

### `estimateMicrousd`
Haiku 5.5 base rates: 0.1 µ$ per input token and 0.5 µ$ per output token. The expected output is a fixed number per
feature (`ask` 400, `overview` 900, `detailed_summary` 1800, `notes` 2200, `insights` 1800, `grade` 150, otherwise
3000); the feature name is `head:tool:key`, so `quiz:grade` is priced as `grade`. Flashcards and quiz tools are priced
at 9000 output tokens because study engine 2 writes a knowledge map first. Negative prompt sizes count as 0.

### `gradePromptFields`
The grader reads its question from the user's own stored quiz, which the browser can write. Every field is
whitespace-collapsed, trimmed and cut: question 300, expected answer 200, at most 8 accepted answers of 120 each,
explanation 400, evidence 1200 (evidence plus the cited lines), the learner's answer 200. A stored quiz therefore
cannot be turned into a large, general-purpose prompt.

## `generateArtifact`, step by step
1. Unknown `kind` → 400 `bad_request`. Settings are normalised (`normalizeSettings`); a draft tool with no request text
   is refused with the tool's own message.
2. The transcript is loaded: missing → 404 `not_found`; no text → 422 `empty`.
3. A stored result is returned (`cached: true`) when it is `ready`, current and not forced. "Current" means same
   transcript version **or** a later version that only renamed speakers (`sameBasis`). A row still `generating` and
   younger than the take-over time is also returned.
4. Otherwise a slot is reserved, the row is claimed (`startArtifact`; if another request claimed it first, its row is
   returned), and the work runs:
   - **Study engine 3** (study guide, flashcards, quiz): several smaller calls in `studyrun.js`, metered one by one.
   - **Older engines:** one structured analysis, grounding against the transcript, speaker codes tokenised, the tool's
     own validation, then (engine 2) a **coverage pass** that writes items for core or supporting concepts still
     untested, from those concepts' lines ±2. It is skipped when the ceiling is reached or more than 150 s of the
     300 s budget has passed.
5. The result records `speakers`, `basis` (so a rename is told apart from a real change), `engine`, and the target
   count for cards or questions. Dropped (ungrounded) items are counted in `dropped` and in the usage record.
6. On error the row is marked failed and **falls back to the previous result and its version** (`failArtifact`), so a
   failed regeneration never loses a good one.

Speakers in Create tools are shown to the model as codes (`S1`, `S2`, …) and it writes `{{S1}}`; the page shows each
speaker's current name, so renaming a speaker later needs no new generation.
