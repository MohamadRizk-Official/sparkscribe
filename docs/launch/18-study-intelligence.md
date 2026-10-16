# Master Phase 2: Focused Review and Across Recordings (2026-10-16)

Branch `feature/study-intelligence` (from `pricing/four-tier`). No database schema change, no Stripe change, no plan gate
enforced, nothing on `main`. Saved recordings, speaker corrections and study outputs are untouched; existing tools
keep working (the existing e2e suites for study, Create, Library and Ask/Summary pass unchanged).

## 1. Capability inventory

| Capability | Before Phase 2 | Phase 2 |
|---|---|---|
| Practice Quiz, Level (Standard/Challenge), Focus (incl. exam), Format | every plan | unchanged, every plan |
| Review missed questions / Retake missed / Retake full quiz | every plan (per question) | unchanged; still shown for older quizzes |
| Study Guide, Flashcards, Notes, Summary, Ask (one recording) | every plan | unchanged |
| Source references (timestamps, click-to-seek) | one recording | also across recordings |
| **Focused Review** (concepts to review, what the recording says, the passages, practice by concept, resume later) | — | new (proposed **Bolt**) |
| **Follow-up practice questions** for concepts already missed | — | new (proposed **Bolt**) |
| **Ask across recordings** (2–12 recordings) | — | new (proposed **Thunder**) |
| **Combined study guide** (2–10 recordings) | — | new (proposed **Thunder**) |

## 2. Focused Review (Bolt)
Flow: Quiz result → **Concepts to review** → one concept at a time (what the recording says, why, the lines with
"Open in transcript" / "Hear it", the question that was missed and its explanation) → **Practice again** → result.
"Continue review" on the quiz screen picks it up later.

- **No new AI for reviewing.** A Study Engine 3 quiz already stores its study map, and every question names its
  concept, so the concept, its summary, reasoning, evidence and lines come from storage.
- **Evidence rules** (`src/insights/focus-review.js`, 27 unit tests):
  - only answered questions count, and "close" or "My answer was right" count as right;
  - a question the learner flags as wrong or unclear stops counting;
  - a miss on a question carrying a transcription caution (a possibly misheard word) goes to **Check the
    recording**, not to "you don't know this";
  - a concept clears when a later answer about it is right; a miss in the same run keeps it open.
- **No scores or mastery percentages.** Only counts of concepts in each state, which have a defensible meaning.
- **Practice uses stored questions first:** not-yet-missed ones first, then the missed ones.
  **Write new questions** (one small AI request) appears only when every stored question on a concept was
  already missed. These follow-ups reuse Study Engine 3's own writer and checker, never repeat a question the
  learner saw, and are capped at 30 per quiz.
- **Saved state** lives in the quiz's existing `progress` field, compacted to fit its 4,000-byte limit:
  - it holds ids only (concepts, question indexes), so speaker renames can't corrupt it (names are resolved
    when shown);
  - regenerating the quiz clears it, as it clears the score;
  - deleting the recording deletes the quiz and so the review.

## 3. Across recordings (Thunder)
Entry points: Library → **Ask across recordings** (or select recordings, then **Ask across** / **Study guide** in the
selection bar). The page `/across?ids=…` lists the selection oldest first, numbered (1, 2, 3…), and has **Add
recordings** (library search), remove, limits (2–12 for questions, 2–10 for a guide) and empty states.

**Retrieval** (`server/ai/across.js`):
- No new infrastructure, no embeddings. The existing Ask ranking (BM25) runs over the passages of every selected
  recording at once, and every recording with a matching passage is represented.
- At most **9,000 tokens** of passages per question, plus each recording's stored overview (summary and key points,
  ≤ 450 tokens) as orientation. A collection that fits is sent whole; a long one is searched.
- Measured: a 3-lecture collection padded to ~22,000 tokens was answered from ~3,900 tokens of the right passages.

**Grounding:**
- Citations are `[R2:45]`, meaning recording 2, line 45. A citation of a line the model wasn't given is removed,
  so nothing can be attributed to a recording it didn't come from.
- Labels left in prose become the recording's title.
- The prompt requires the model to:
  - keep recordings apart and go oldest first;
  - state disagreements with both sides cited;
  - claim "in every recording" only with a citation from each;
  - say when something is missing;
  - not merge same-named speakers or terms across recordings.

**Combined study guide:**
- Built from each recording's stored study map (Study Engine 3), not from transcripts.
- A recording without a map first gets its own study guide, saved with it.
- One synthesis call follows. Every theme, definition, distinction and self-check question must point at
  concepts that exist; "recurring" (in 2 or more recordings) is computed from those references, never from the
  model's prose.

**Saved work:**
- Questions, answers and guides are kept in this browser, per account, for the last 10 selections, and cleared at
  sign-out. No server storage.
- Each saved answer records the recording versions it came from. A deleted recording disables its links and the
  answer says so; an edited one is flagged ("ask again").

**Security:**
- Every recording is read as the signed-in user (Row Level Security); an id that isn't theirs is reported as
  unavailable, with no title or text.
- Requests are reserved and settled in the existing AI usage ledger: plan budgets, the hourly limit and the daily
  service breaker all apply.
- At most 2 cross-recording questions and 1 combined guide run at once per user (checked on the user's own ledger
  rows).

## 4. Test evidence
- **Unit:** `tests/focus-review-test.mjs` 27, `tests/followups-test.mjs` 13, `tests/across-test.mjs` 29 (mock AI,
  in-memory store). Full `npm test` passes.
- **Database (PGlite with every production migration):** `qa/sql/study-intelligence.test.mjs`, 17 checks:
  - other users' recordings, overviews and maps are invisible by id;
  - signed-out users are refused;
  - progress and follow-up writes only reach the user's own quiz, with an optimistic version check;
  - progress is bounded;
  - ledger rows are private and can't be forged.
- **Browser (QA harness, mock AI):** `qa/e2e/focus-review.e2e.js` 7 and `qa/e2e/across.e2e.js` 14, all passing.
  Existing suites rerun: study 7, create 5, library 7, insights 3, all passing.
- **Real model** (`qa/ai-real/across.mjs`, Haiku 5.5, synthetic recordings in `qa/fixtures/across.mjs`):
  - **9 of 9 questions passed every check**: contradiction and chronology, recurring concept, comparison of two
    lectures, missing information (no citations), similar titles kept apart, a decision changed between meetings,
    a repeated action item, a mixed collection staying on topic, and a long collection in retrieval mode;
  - 0 invalid citations removed;
  - the combined guide found the recurring osmosis theme and the ATP correction, with every item sourced;
  - follow-ups produced a new, well-formed question on the missed concept.

## 5. Measured cost (Haiku 5.5: $0.10 / M input, $0.50 / M output)
| Action | Measured | Bound |
|---|---|---|
| Focused Review (reviewing, practising stored questions) | $0 | $0 |
| Follow-up questions (1 concept) | $0.0016–0.0020, ~11 s | ≤ 6 concepts per request, ≤ 30 per quiz |
| Ask across (2–3 recordings) | $0.00045–0.00093, 1–5 s | ≈ $0.002 per question (9k passages + 12 overviews) |
| Ask across, long collection (retrieval) | $0.0007, 3.7 s | same bound |
| First question on a recording without a summary | ≈ $0.001–0.003 per recording, once (also serves its Summary tab) | — |
| Combined guide (3 lectures) | $0.0015–0.0025, 11–17 s | ≈ $0.004 (10 recordings) |
| Study map for a recording without one | $0.002 per short lecture (≈ $0.01 per hour), once (reused by its quiz and flashcards) | — |
| Repeating a question already answered on this device | $0 (saved) | — |

**Monthly estimates per user:**
- **Bolt, normal** (10 focused practice requests): about **$0.02**.
- **Thunder, normal** (40 questions, 4 guides, maps for 20 recordings once): about **$0.25**.
- **Thunder, heavy** (300 questions, 20 guides, 40 new hour-long maps): about **$1.10**, or 7% of $14.99.

The plan's monthly AI budget is a hard ceiling either way, once enforcement is on in production.

## 6. Limitations (honest)
1. Saved cross-recording answers and guides are per browser, not synced; cloud history needs a small table (a
   Phase 3 decision).
2. Speaker names in a saved cross-recording answer are those at answer time; links always open the current
   transcript.
3. For long collections the model sees the top passages, not everything. It is instructed to say "didn't come up in
   what I could see" rather than claim absence.
4. Concept tracking is per quiz. Weak topics across several quizzes or a whole course are not tracked yet.
5. Focused Review needs a Study Engine 3 quiz (one with a study map). Older quizzes keep the per-question review.
6. A combined guide over many recordings without maps makes those maps one at a time first, which takes minutes for
   long lectures.
7. Plan gates are not enforced (by instruction): every signed-in user can use these features until Phase 3.

## 7. Recommendation
- **Bolt: Focused Review + follow-up practice.** It adds genuinely new, persistent concept-level tracking. The
  existing per-question review, retakes, difficulty and focus stay on every plan.
- **Thunder: Ask across recordings + Combined study guide.** They are working, grounded and cheap enough even
  for heavy use.
- Before advertising them as paid benefits, Phase 3 should add the server-side plan check on `/api/across` and on
  the follow-ups action, set Flash/Bolt/Thunder AI budgets, and decide whether answer history should sync.
