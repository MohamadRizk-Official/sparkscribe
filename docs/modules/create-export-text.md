# Copy and Export text for Create tools (`src/insights/tools.js`)

Every Create-tab result becomes a flat list of **blocks** before it is copied or exported, so Copy, Markdown, Word, PDF and
text all say the same thing. Test: `tests/artifact-blocks-test.mjs`.

## Blocks
`{ t, text, time? }` where `t` is one of:
| `t` | meaning |
|---|---|
| `h` | heading |
| `p` | paragraph |
| `li` | list item |
| `quote` | a quote, written `“text” — speaker` |
| `meta` | a note such as "Draft — review before sending." |
| `pre` | text that keeps its line breaks (email and reply bodies) |

`time` is seconds into the recording, taken from the item's `refs` through the `timeOf(refs)` function the caller passes in,
or `null`. A time of `0` is a real time.

## `artifactBlocks(kind, content, timeOf)`
- No content, or an unknown kind: `[]`. A section only gets a heading when it has items, so an empty result has no blocks.
- `study_guide`: Overview, Major topics, Important concepts, Definitions, Examples, Processes and sequences (steps numbered in one line), Important relationships, What the lecturer emphasised, Explicit exam information, Worth reviewing, Check yourself.
- `flashcards`: a "Card n" heading, then `Q:`, `A:` (with the time), and `Why:` / `Note:` only when the card has them. Old spelling notes ("Spelling not found in the transcript: X. Check the recording.") are shown in the current wording ("Spelled differently in the transcript: X.").
- `quiz`: a "Question n" heading, the options (lettered `A.`, `B.` for multiple choice only), then `Answer:` with the explanation after a dash.
- `action_plan`: "Still to do" lists only `open` tasks (a result made before statuses existed counts every task as open); "Completed in this conversation" lists `completed_in_recording` tasks with what happened and the time of that line. Cancelled, discussed-only and unclear tasks are not exported. No open tasks gives "Nothing is left to do after this recording." The owner reads `Owner not specified`, the name, or `Likely owner: name` when the owner was only inferred.
- `meeting_recap`: overview, participants (one line), topics, confirmed decisions, action items (`Owner: … · Deadline: …`, "Not specified" when missing), open questions, follow-ups, important dates.
- `followup_email` / `reply_draft`: a review note first; the email adds `Subject:` and a `pre` body.
- `interview_qa`: a note when the recording is not mainly Q&A, a heading per question (with who asked), the answer (with who answered), then important quotes. `episode_notes`: summary, chapter outline, takeaways, quotes.
- `definitions` and `exam_points` (older results) are still exportable.

## `blocksToText(blocks)`
Headings stand apart with a blank line, list items start with `- `, and a block with a time ends in `[m:ss]` or `[h:mm:ss]`. The
result ends with one newline; no blocks gives just a newline.

## `toolsFor(type)` → `{ tools }`
Which tools a recording type suggests first: lecture → flashcards, quiz, study guide; meeting → meeting recap, action plan,
follow-up email; interview → interview Q&A; podcast → episode notes; voice message → reply draft, action plan. Unknown or
missing types get the general set (study guide, flashcards, quiz). Every tool is still available on any recording.
