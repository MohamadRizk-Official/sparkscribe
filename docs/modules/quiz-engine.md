# Practice Quiz engine (`src/insights/quiz-engine.js`)

Pure state functions for a quiz run, no DOM and no AI calls. The questions are the stored, grounded quiz generated
once, so starting, retaking, or retaking only missed questions costs nothing. Covered by `tests/quiz-engine-test.mjs`.

## A run
`newRun(questions, { only, shuffle, kind })` returns:

```js
{ kind, items: [{ qi, order }], i: 0, answers: [], done: false }
```

- `qi` is the index of the stored question; `order` is the order its options are shown in.
- `kind` is `full` by default, `missed` when `only` is a non-empty list, or whatever `kind` is passed (`focus` for Focused Review).
- `only` keeps the given order and drops indexes that do not exist. An empty list means a full run.
- `shuffle` mixes the option order for `multiple_choice` only. The correct answer is the same text, only its position changes. True/False and short answers keep their natural order.

Keeping the queue explicit is what later lets an adaptive mode insert items without changing the screens.

## Answering
- `answer(run, questions, given)`: multiple choice and true/false must match `question.answer` exactly; `short_answer` is graded leniently by `localGrade` (`src/insights/tools.js`).
- `record(run, given, { verdict, typo })`: for short answers graded by meaning. `close` counts as correct; only `incorrect` does not.
- `overrideCorrect(run)`: the learner says their short answer was right. Marks it `overridden`. Does nothing if there is no answer yet.
- `advance(run)` moves on; it returns `true` and sets `done` when that was the last item (the index stays on the last item).

## Results
- `answeredCount`, `correctCount` count recorded answers.
- `summary(run)` returns `{ strong, missed, score, total }` using stored question indexes. Unanswered items count as missed. Feed `missed` back into `newRun(..., { only })` to retake.
