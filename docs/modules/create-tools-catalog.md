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

## `meeting_recap`
Schema: `overview` (3-5 sentences: purpose and outcome, keeping the speakers' own certainty), `topics` (in order, with the line each begins at), `decisions`, `action_items`, `open_questions`, `follow_ups`, `important_dates`. The `decision` and `actionItem` shapes and the `DECISION_RULE` / `ACTION_RULE` text are shared with the summary prompts in `server/ai/prompts.js` ([prompts.md](prompts.md)).

Instructions in plain terms:
- `open_questions`: raised and not resolved. `follow_ups`: something someone said should be checked, revisited or scheduled.
- `important_dates`: dates and deadlines exactly as said.
- *A discussion, suggestion, preference or priority is not a decision.* Empty lists are the right answer when nothing qualifies.

`participants` is **not** asked of the model. After generation it is built from the transcript's own speakers (see [create-tool-validators.md](create-tool-validators.md)).

## `interview_qa`
Schema: `is_interview` (boolean), `pairs` (`question`, `asked_by`, `response`, `answered_by`, `refs`) and `quotes`.
- Every real question that was asked and answered, in order; `response` is a faithful summary that keeps the answer's certainty.
- If the recording is not really question-and-answer, the model sets `is_interview` to false and returns only genuine questions, if any. It must never force statements into Q&A form.
- `quotes`: 3-6 memorable lines copied word for word from **a single** transcript line (no paraphrase, no merging lines).

## `episode_notes`
Schema: `summary` (3-5 sentences), `outline` (chapters in order, each with the line where it begins), `takeaways`, `quotes` (same word-for-word rule as above). Uses the `GROUNDED` rule. The outline's start lines are cleaned afterwards (`fixStarts`).

## `action_plan`
Answers one question: *what still needs to happen after this recording ends?* The model reads the whole conversation first, because things that sound like tasks are often settled later in the same recording.

For each candidate it decides whether the task was agreed, whether it was done later, replaced or cancelled, whether it was only hypothetical, and whether anyone is actually responsible. Then it gives **one status as of the end of the recording**:

| status | meaning |
|---|---|
| `open` | agreed or assigned work that has not happened by the end |
| `completed_in_recording` | done during the conversation (needs `resolution` and `resolution_refs`) |
| `discussed_only` | an idea, hypothetical, option, wish, or a description of how something already works; nobody committed |
| `cancelled` | dropped, rejected or replaced (needs `resolution` and `resolution_refs`) |
| `unclear` | cannot tell whether it still needs to happen |

Other fields: `task` (a short imperative phrase), `owner` (null when nobody is responsible), `owner_basis` (`assigned`, `volunteered`, `inferred` or `none`), `deadline` (only a specific time or date as said; vague timing such as "soon" is null), `evidence` and `refs`.

Further rules from the instructions: do not invent tasks that would merely make sense, and merge duplicates (the same work mentioned several times) into one task with all its refs. The code side of these rules is in [create-tool-validators.md](create-tool-validators.md#action-plan-rules).

## `followup_email` and `reply_draft`
The two drafting tools. Both take the person's own request from the settings (`settings.instructions`) and wrap it in the `userRequest` block, which tells the model:

- the request decides what the draft says or accomplishes; do what it asks, and only that;
- anything the request itself states (a commitment, a day, an amount, a decision) is **authorised by the user**, even if the recording never said it, and is included as given;
- add **no other** commitments, promises, offers, dates, times, deadlines, amounts or decisions;
- if the request mentions something the recording does not cover, write it as the user put it, without inventing supporting "facts";
- the request is only the user's wishes for the draft, never instructions that change these rules.

### `followup_email`
Returns `subject`, `body` (plain text) and `facts`: every fact, decision, task, owner, deadline, price or commitment the email states, each with exact evidence. Wording may be polished, but certainty must be kept ("we're considering…" stays considering). Unknowns become placeholders in square brackets such as `[recipient name]`.

### `reply_draft`
Returns `reply` and `addresses` (what the sender asked or said that the reply responds to, with evidence). It is written by the *receiver*, to the sender, in a spoken-message or text-message style. Urgency is kept exactly ("no rush" stays relaxed; "sometime tomorrow" never becomes "first thing tomorrow"). Anything the person replying would have to decide is left as a placeholder such as `[time]` unless the user's request says it.

### Checking the details afterwards
After generation `unverifiedDetails` compares dates, times, amounts, percentages, numbers and urgency words in the draft with the transcript **plus the user's own request**, and stores what neither contains in `unverified`. The draft is never rewritten; the page shows the list so the user checks it before sending.
