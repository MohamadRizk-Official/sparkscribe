# Ask rebuild, playback starts, back navigation (2026-10-26)

Branch `design/polish`, Preview https://sparkscribe-git-design-polish-moerizz.vercel.app. Production unchanged until approval.
Screenshots (synthetic seed recordings only): `docs/launch/shots-ask/` (before-*, after-*).

## 1. Playback started a sentence early, or mid-word

**Root cause.** A transcript paragraph is one piece of audio cut by the engine (16–27.5 s at most). Its start time is
where the cut fell, not where a sentence begins. When no pause was close enough, the cut went through speech. The two
pieces then shared 1 s of audio, and the repeated words were removed from the second piece's text but not from its
start time. Clicking that paragraph (or any reference to it) replayed the last words shown above it, or began
mid-word. There are no word-level timestamps (Whisper timestamp decoding stays off: changing the decoder is a
transcription-accuracy risk).

**Fix (`src/lib/breath.js`).** Each recording keeps a small loudness envelope: 20 values a second, one byte each,
~70 KB per hour. It is made from the same decoded audio as the transcript and stored with the audio in this browser's
IndexedDB. It is never uploaded.

Every seek from a paragraph click, a group time, or a reference in Summary, Notes, Ask or Create goes through
`paragraphStart()`:
- It starts in the pause nearest the paragraph's start (searching 1.6 s back and 0.5 s ahead), 0.12 s before the words
  resume. Skipping words costs 2.5× more than starting slightly early.
- A cut through speech (same voice, no gap, loud at the cut) is detected, and the start moves past the shared second
  first.
- The clicked paragraph stays highlighted through the short lead-in.

Audio kept before this change gets its envelope once, when the page is idle (files up to 40 MB). Larger files without
one fall back to a 0.1 s lead-in.

Check on a real 17.5-minute meeting recording (AMI ES2004a): 36 of 42 arbitrary seek targets landed in a measured
pause, on average 0.44 s earlier than the raw time. Unit tests are in `tests/ask-format-test.mjs`.

## 2. Ask: answers, citations, sources

**Before.**
- The prompt demanded "Plain text, no headings, no markdown tables".
- The renderer only knew paragraphs and "- " lists.
- Every cited line became its own timestamp chip, so one sentence could carry three or four chips.

**Generation (`server/ai/prompts.js`, `ASK_SYSTEM`).**
- The answer's shape follows the question: one to three plain sentences for a fact or yes/no, "- " lists for separate
  items, "1." for steps, a small table only for comparisons, "##" headings only for longer multi-part answers.
- Bold is limited to a few words.
- No filler: no preamble, no "Great question!", no closing offers.
- The model never writes recording times itself.
- It cites one to three supporting lines per sentence, list item or table cell.

Same model (Haiku 5.5), same retrieval, same limits and metering.

**Renderer (`src/insights/answer-format.js`).**
- Supports a Markdown subset: headings, paragraphs, bold and italic, inline code, "- " lists (one nested level),
  numbered lists, tables and "> " quotes.
- Every character is escaped first, and only those tags are produced. Model HTML, links, images and attributes never
  become markup. Link syntax keeps its text only.
- Unfinished markup while streaming stays plain text.
- Saved answers (plain lines and "- " lists) render as before.

**Citation data structure.**
- Nothing new is stored. The stored answer text (with `[12]` / `[12, 15]` / `[12][15]`) stays the source of truth.
- At render time `extractCitations()` turns each bracket cluster into one group `{ n, ids }`:
  - ids are sorted and deduplicated, and only ids that exist in this transcript are kept;
  - groups are numbered in reading order, and the same set of lines cited again reuses its number.
- Because this is derived from the text alone, a saved answer shows the same numbers every time it is reopened.
- The server already removes lines the model wasn't given (`groundAnswer`).
- Times always come from the transcript lines, never from model text.

**Grouping and navigation.**
- Each group is one small bracketed number ([1]) attached to the word before it.
- Clicking it opens a popover beside it: a bottom sheet under 640 px, easing in over 200–240 ms.
- The popover lists each moment: time, speaker, and the sentence of that line that best matches the claim (up to ~240
  characters).
- Choosing a moment:
  1. switches to the transcript;
  2. scrolls the passage into view clear of the sticky header (scroll-margin);
  3. shows a calm cyan tint with a lit edge that fades over 2.4 s;
  4. plays from the pause before it when the audio is on this device.
- Without audio, the moment says "Show in transcript", and there is no play icon.
- The popover closes on Escape (focus returns to the number), an outside click, the number again, the close button, a
  tab change, or a redraw.
- Keyboard: the number is a button with `aria-expanded`, `aria-controls` and `aria-haspopup="dialog"`. Focus moves to
  the first moment.

**Ask UI.**
- Empty state: "What would you like to know?" with a lit tile.
- Suggestion buttons: brighter surfaces with a 2px blue edge (charcoal-blue in light mode).
- No scrollbar in an empty question box; one appears only past 140 px.
- Wide tables scroll inside the answer and never widen the page.

**Cost and latency.** The same three questions on the same synthetic meeting, real Haiku 5.5:

| | input tokens | output tokens | cost | latency |
|---|---|---|---|---|
| old prompt | 2,829 / 2,994 / 3,226 | 142 / 713 / 668 | $0.00167 total | 2.6 / 3.7 / 3.4 s |
| new prompt | 3,235 / 3,363 / 3,596 | 105 / 595 / 549 | $0.00164 total | 1.3 / 3.2 / 3.7 s |

The prompt adds ~400 input tokens; the answers came out slightly shorter. Net cost is unchanged (−1%). There are no
extra calls.

Plans: Ask is unchanged in who can use it (all plans with Ask). The Flash-plan e2e passes. Across-recordings stays
Thunder-only.

## 3. Back from Pricing returned to an empty home

On `/`, a fresh result lives only in that page. Once it is saved, the address now becomes `/transcript?id=…`
(`history.replaceState`), so Back from Pricing (or a reload) opens that recording. Starting over restores `/`.

## 4. Speaker names

Clicking a speaker's name now offers **Edit name…** first, on the saved page and on the fresh result. It renames
everywhere. Saying who really said a paragraph stays below it. Before, the rename sat last as "Rename … everywhere"
on the saved page, and the fresh result had no rename in that menu at all.

## Tests

- `npm test` passes, including the new `tests/ask-format-test.mjs` (24 checks: safety, formatting, grouping, stable
  numbering, invalid ids, excerpts, pause detection).
- Browser e2e on the QA harness: home save 8/8, insights 3/3, AI limits 5/5, Thunder Ask on Flash 2/2.
- Manual checks:
  - the popover opens, closes on Escape, an outside click and a re-click, and navigates with the highlight;
  - a reopened saved answer keeps the same numbers;
  - "Edit name…" renames everywhere;
  - a phone width of 390 px has no horizontal scroll.
- `npm run build` passes.

Not changed: Stripe, pricing, entitlements, usage metering and AI budgets, auth, Supabase permissions, recording
ownership, transcript storage, saved questions, audio privacy (audio and the envelope stay on the device), Thunder
restrictions, and `src/engine/diarize.js`.
