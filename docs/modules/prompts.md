# AI prompts and schemas (`server/ai/prompts.js`)

The instruction text and the structured-output schemas the server sends with every AI request. Tests: `tests/prompts-schemas-test.mjs`, `tests/prompts-instructions-test.mjs`.

## Schemas

Every schema is **strict**: all properties are required and `additionalProperties` is `false`, so a result can be checked field by field by [grounding](grounding.md). The schema test enforces this for every schema, nested objects included.

| export | used for |
|---|---|
| `OVERVIEW_SCHEMA` | short summary, key points, chapters (`start_ref` is an integer line number) |
| `DETAILED_SCHEMA` | the sectioned detailed summary |
| `NOTES_SCHEMA` and `NOTE_TYPES` | notes grouped by topic; each item has one of the note types (`point`, `detail`, `definition`, …) |
| `INSIGHT_SPECS[type]` | `{ schema, instructions }` per recording type: `general`, `meeting`, `lecture`, `interview`, `podcast`, `voice_message`. There is exactly one spec for each of `RECORDING_TYPES` in [segments.md](segments.md) |
| `EXPAND_SCHEMA` | the keywords used to widen retrieval on a long recording ([retrieve.md](retrieve.md)) |
| `GRADE_SCHEMA` | a quiz answer's `verdict` (`correct`, `close` or `incorrect`), one sentence of `feedback`, and an optional `corrected` spelling |

## Instruction builders

- `overviewInstructions({ minutes, withChapters })`: summary length scales with the recording. Under 3 minutes: 3 sentences and 2–4 key points; under 20 minutes: 3–5 and 3–6; otherwise 4–6 and 5–8. With `withChapters` false the model is told to return an empty chapter array.
- `detailedInstructions(type)` and `notesInstructions(type)`: wording per recording type; an unknown type uses the `general` wording.
- `expandInstructions(question)`: asks for 5–15 words or phrases likely to appear near the answer; the question is quoted in triple quotes.
- `gradeInstructions({ question, expected, accept, explanation, evidence, answer })`: wraps each part in tags. `<also_accepted>` appears only when there are alternatives. "What the recording says" uses `evidence`, else `explanation`, else `expected`. The learner's answer is declared to be data, never instructions.

## Shared rules

`SPEAKER_RULE`, `MEANING_RULES`, `DECISION_RULE`, `ACTION_RULE` and the system prompts (`ANALYST_SYSTEM`, `ASK_SYSTEM`, `GRADE_SYSTEM`) are plain strings reused across the builders. Speakers are referred to by code, see [speaker-refs.md](speaker-refs.md).
