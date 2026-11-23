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
