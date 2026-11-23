# Create-tab tools: what each one asks for (`server/ai/tools.js`)

[create-tool-validators.md](create-tool-validators.md) explains what happens to the model's output *after* it comes back. This page is the other half: what each tool in `TOOLS` asks the model to produce. Each entry has a `task` name, a JSON `schema`, `instructions()`, a `validate` step and sometimes `after`, `focusNote`, `itemsKey` or `beforeGrounding`.

The tools are: `study_guide`, `flashcards`, `quiz`, `definitions`, `exam_points`, `meeting_recap`, `action_plan`, `followup_email`, `reply_draft`, `interview_qa`, `episode_notes` (`ARTIFACT_KINDS`).

## Rules every tool shares
- **Grounding.** Output goes through the shared grounding pass (`grounding.js`, [grounding.md](grounding.md)): unknown line ids are removed, items without a real line are dropped, and `quote` / `evidence` fields are checked word for word.
- **Speakers are codes.** Names are written as `{{S1}}`-style codes ([speaker-refs.md](speaker-refs.md)), so renaming a speaker later updates saved results.
- **The `GROUNDED` sentence** ("Everything must come from this recording only…") is part of the study guide, definitions, exam points and episode notes instructions: no textbook knowledge, background facts, examples or definitions the speakers did not give.
- **Settings are part of the cache key.** `normalizeSettings` is the same function the browser uses (`src/lib/tool-settings.js`, [tool-settings.md](tool-settings.md)).

## Study engine 3
`study_guide`, `flashcards` and `quiz` use `engine: STUDY_ENGINE_3`: instead of one model call they build a section-by-section study map first and then choose items to cover it ([studymap-pipeline.md](studymap-pipeline.md)). The other tools are a single model call.

## `study_guide`
Sections (all lists may be empty): `overview` (2-4 sentences), `topics` (2-6 word titles with a summary and the line where the topic begins), `concepts`, `definitions`, `examples`, `processes` (ordered steps), `relationships`, `emphasis`, `exam_info`, `review`.

What the instructions insist on:
- `definitions` only for terms the lecturer actually defined or explained; `evidence` is their exact words.
- `emphasis` only for what was explicitly stressed, with the exact words.
- `exam_info` **only** where an exam, test, quiz, midterm or assignment is referred to, or the lecturer says to know or study something. Never claimed otherwise.
- `review` is neutral wording with no exam claims.

### Focus
The study guide has three optional focus notes that change emphasis and depth only; the grounding rules stay:

| focus | effect |
|---|---|
| `exam` | short overview; thorough `exam_info`, `emphasis`, `definitions`, `review`; essentials only for concepts and examples |
| `concepts` | concentrate on concepts, definitions and relationships; keep examples and review short |
| `detailed` | cover every topic taught, more points per section, full steps of processes |

## `flashcards` and `quiz`
Both take their schema (`FLASHCARDS_SCHEMA`, `QUIZ_SCHEMA`) and instructions (`flashcardInstructions`, `quizInstructions`) from `server/ai/study.js` ([study-validation.md](study-validation.md)) and run on study engine 3.

- `itemsKey` is `cards` for flashcards and `questions` for quiz. It names the list the generic code works on.
- `beforeGrounding` runs `inheritRefs(items, json)` first, so an item that came back without its own line references inherits them from the study-map section it was made from; then grounding drops what still has no real line.
- Validation is `validateFlashcards` / `validateQuiz`.

### How many cards
`cardCount(minutes, size)` is the standard target, and the model may return fewer when the material is thin:

| recording length | standard |
|---|---|
| under 10 minutes | 8 |
| 10 to under 40 minutes | 15 |
| 40 minutes or more | 25 |

`size: 'fewer'` halves it (rounded, never below 5); `size: 'more'` multiplies by 1.6 (rounded, never above 40). The quiz count uses `questionCount`, which is `quizQuestionCount` from `src/lib/tool-settings.js`, so the setup screen and the server agree.

## `definitions`
Schema: a list of `{ term, definition, evidence, refs }`. The instructions allow a term only if the lecturer explicitly defined it or meaningfully explained what it is: *a term that was only mentioned does not get a definition*. `definition` is what the lecturer said, lightly cleaned, with the same meaning; `evidence` is their exact words. Duplicate terms are removed afterwards.

## `exam_points`
Two strictly separate lists:

| list | holds | each item |
|---|---|---|
| `explicit` | only what the lecturer connected to an exam, test, quiz, midterm, assignment or grading, or "know this", "study this", "this will be on…", "important for the exam" | `text`, `evidence` (those exact words), `refs` |
| `worth_reviewing` | points that seem important (stressed, repeated, called key) but were **not** tied to an assessment | `text`, `reason` (neutral, e.g. "stressed twice"), `refs` |

The instructions forbid saying that anything in `worth_reviewing` will be examined, and the validator enforces the first list in code: an `explicit` item that is not `examBacked` moves to `worth_reviewing` with the reason "Not tied to an exam in the recording".
