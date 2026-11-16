# Create-tab tool checks (`server/ai/tools.js`)

Each Create-tab tool (`TOOLS.<kind>`) is a JSON schema, instructions for the model, and a **validator** that runs after the
shared grounding pass (`grounding.js`). The validators fix or drop what the model got wrong and return how many things they
had to correct; the count goes to the usage log so you can see how often the model needed correcting. Test:
`tests/tools-validators-test.mjs` (the full generate/store flow is in `tests/tools-test.mjs`).

## Exam wording
- `EXAM_RE` matches words that make something *explicit exam information*: exam, midterm, quiz, test, assessment,
  assignment, homework, graded, "study this", "know this", "will be on", "important for". "examination" does not match.
- `examBacked(item, segments)` is true when the item's own `evidence` matches `EXAM_RE`, **or** one of the transcript lines
  it points at (`refs`) does. Anything else is at most "worth reviewing".

## Per tool
| tool | what the validator does | returns |
|---|---|---|
| `study_guide` | an `exam_info` item that is not `examBacked` moves to `review`; a process needs at least two non-blank steps; definitions with the same term (case and punctuation ignored) keep the first | moved + dropped processes + duplicates |
| `definitions` | same duplicate rule; an entry with no term is dropped | duplicates dropped |
| `exam_points` | an `explicit` point that is not `examBacked` moves to `worth_reviewing` with the reason "Not tied to an exam in the recording" (the list is created if missing) | points moved |
| `action_plan` | see below | statuses fixed |
| `followup_email`, `reply_draft` | sets `unverified`: details in the draft that neither the recording nor the user's request mentions | 0 |
| `meeting_recap`, `interview_qa`, `episode_notes` | no validation | 0 |

### Action plan rules
- A status outside `PLAN_STATUSES` (`open`, `completed_in_recording`, `discussed_only`, `cancelled`, `unclear`) becomes `unclear` (counted).
- `owner_basis` must be `assigned`, `volunteered`, `inferred` or `none`; an unknown value becomes `inferred` when there is an owner, and no owner always means `none`.
- `resolution_refs` are made numbers, kept only if the line exists, de-duplicated, sorted and cut to five.
- `completed_in_recording` or `cancelled` **without** a real resolution line becomes `unclear` (counted): "done" must point at where it was done.
- `open` and `unclear` tasks carry no resolution text or lines.

## After-steps (`after`)
- `study_guide`, `meeting_recap` and `episode_notes` run `fixStarts` on their topic lists: entries without a title are dropped and `start_ref` becomes a number, or `null` if that line does not exist.
- `meeting_recap` builds `participants` from the transcript's own speakers (lines per speaker, most first, "Unknown" left out). A speaker with a code is written as `{{S1}}` so renames show; the model never supplies participants.

## Helpers
- `cardCount(minutes, size)`: standard 8 cards under 10 minutes, 15 under 40, otherwise 25. `fewer` halves it (never below 5); `more` multiplies by 1.6 (never above 40).
- `questionCount` is the quiz setup's count from `src/lib/tool-settings.js` (shared with the browser).
- `unverifiedDetails(text, transcript)`: weekdays, months, clock times, amounts, percentages, numbers of two or more digits and urgency words ("tomorrow", "ASAP", "end of day") that are **not** in the transcript; at most ten, de-duplicated. The draft is flagged, never rewritten.
- `ARTIFACT_KINDS` is the list of tool names (`Object.keys(TOOLS)`).
