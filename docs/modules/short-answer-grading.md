# Instant short-answer checking (`src/insights/tools.js`: `localGrade`)

Quiz short-answer questions are checked in two steps. This is step one: it runs in the browser, instantly, without AI.
Anything it does not accept is sent to the server, which judges **meaning** against the recording (`correct`, `close` or
`incorrect`); "My answer was right" stays available as a fallback. Test: `tests/local-grade-test.mjs`.

## `localGrade(given, question)` → `null` or `{ verdict: 'correct', typo }`
`question` is `{ answer, accept? }`. It never says "wrong": it either recognises an obvious match or returns `null`.

1. **Words.** Both texts are lower-cased, NFKC-normalised, stripped of punctuation, and filler words are removed
   (`a an the of to in on for and or is are was were be by with that this it its as at from just only around about some`).
2. **Stems.** `-ies` → `-y` (categories → category), `-ses/-xes/-ches/-shes` lose `es` (boxes → box), a trailing single `s`
   is dropped (cells → cell) unless it is `ss` (class stays) or the word is three letters or shorter.
3. **Compared against** `answer` and each entry of `accept`. A match is:
   - the same words joined together in the same order, which also covers spacing ("door dash" = "DoorDash"); or
   - at least **75 %** of the expected words present in the answer, in any order. A word counts when it is present exactly
     or as a **typo** of an answer word.
4. **Typo rule** (conservative): a short word must be exact; a word of 5+ letters may differ by one edit; 9+ letters by two.
   `typo: true` tells the page the answer was accepted despite a spelling slip.

Returns `null` for an empty answer, an answer made only of filler words, or when nothing matches. An expected answer with
no words is skipped.

`shortAnswerCorrect(given, question)` is the yes/no form (`!!localGrade(...)`).

## What it deliberately does not do
- It does not accept synonyms or paraphrases ("powerhouse" for "mitochondria"); that is the server's job.
- One word of a three-word alternative is not enough (25 % of 3 words rounds below the 75 % line).
