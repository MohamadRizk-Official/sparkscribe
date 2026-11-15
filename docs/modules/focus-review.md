# Focused Review (`src/insights/focus-review.js`)

Pure logic (no DOM, no AI) that turns quiz mistakes into a concept-by-concept review. Test: `tests/focus-review-test.mjs`.
Needs a quiz made by study engine 3: `supportsReview(content)` is true when the study map has concepts and some
question names its concept.

## State
Stored in the quiz's `progress.review` (≤ 4000 bytes shared with the score). Ids only — concept ids and question
indexes — so renaming a speaker or regenerating questions cannot leave stale text. `readState` ignores anything
malformed. Concept states (`STATE`): `review`, `reviewed`, `cleared`, `check`.

## What counts as evidence
- only answered questions;
- a "close" short answer or "My answer was right" counts as right;
- a question the learner flagged as wrong/unclear is no evidence (`flagQuestion`);
- a question with a transcription caution means "check the recording", not a gap in understanding;
- a concept stays open until a later answer about it is right; a miss in the same run keeps it open.
There is deliberately no mastery percentage.

## Functions
`recordRun(state, questions, run, conceptIds)` folds in a run; `markReviewed` ("Got it"); `flagQuestion`; `compact`
(newest first, cleared dropped first, to fit the size limit); `reviewList(state, content)` and `counts(list)`;
`openConcepts` (review or reviewed); `practiceItems` (unmissed questions first, then missed, never flagged);
`needsNewQuestions` (concepts with nothing left to practise); `withState(progress, state)` merges into progress.
`allQuestions(content)` is the quiz questions followed by follow-ups; indexes are positions in that list.
