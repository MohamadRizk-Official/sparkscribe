# Study item validation and prompts (`server/ai/study.js`)

The model writes flashcards and quiz questions; the server checks every item before the user sees it. Items that fail a
check are dropped and counted in `content.quality`, a map of reason → count (plus `kept`, `over_limit`,
`core_uncovered`, `explanation_removed`, `speaker_reference_fixed`). Both validators return the number of dropped items
(the counters that are not drops are not included). Covered by `tests/study-validate-quiz-test.mjs` (quiz),
`tests/study-test.mjs` (flashcards and helpers) and `tests/study-instructions-test.mjs` (prompts).

## Prompts
- `flashcardInstructions({ count, settings, dominant })` and `quizInstructions(...)`: the count is "a ceiling, not a target". `settings.focus` (`essentials`, `balanced`, `deep`) and `settings.explain` (`helpful`, `every`, `brief`) pick text from `FOCUS` and `EXPLAIN`; unknown values fall back to `balanced` / `helpful`. Quizzes also take `settings.types` (`mixed`, `multiple_choice`, `true_false`, from `QUIZ_TYPES`) and `settings.difficulty` (`harder` or standard).
- `STYLE_RULES` is appended to both: questions are self-contained, test understanding, avoid transcription errors, keep attribution, and claim only what the recording supports.
- `speakerNote({ dominant })`: when one speaker says almost everything they are "the lecturer" (never "According to {{S1}}"); otherwise speakers are named only when it matters, by code in double braces.

## Quiz checks (`validateQuiz`), in order
For each question: `empty` (question under 8 characters, or no answer) → `ungrounded_concept` (the concept was removed by grounding; a concept the model never listed is kept as `unmapped`) → `minor_concept` → `unreliable_source` → `wrong_type` (when a single type was chosen) → `vague` (starts with a bare "he", "it", "this"…). Then by type:

- **multiple_choice**: duplicate options are merged; 3–5 options with exactly one matching the answer (else `malformed`); no "all/none of the above" (`all_none_option`); the correct option may not be at least 1.8× as long as the longest other and 25+ characters longer (`giveaway_length`). Options are shuffled deterministically from the question text, so the order is stable.
- **true_false**: the answer must be true or false (`malformed`), normalised to `True`/`False`. In a mixed quiz only `distinction` or `misconception` skills are allowed and at most two (`trivial_true_false`).
- **short_answer**: answer of at most 120 characters (`malformed`), not `circular`; `accept` keeps up to six trimmed, non-empty alternatives.
- any other type is `malformed`.

Finally: `attribution_lost` (a criticised or attributed position must keep who holds it), `duplicate` (similar to an earlier question, or a third question on one concept), then the explanation is removed if it merely restates the answer. A dominant speaker's code in a question becomes "the lecturer" and counts as `speaker_reference_fixed`. At most `count` questions are kept; the rest are `over_limit`. `core_uncovered` counts core concepts with no question.
