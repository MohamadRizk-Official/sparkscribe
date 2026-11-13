# Sentences inside a line (`src/lib/breath.js`, `src/lib/align-words.js`)

How a transcript line is split into sentences and how each sentence gets a start time. The result feeds [seek.md](seek.md). Tests: `tests/split-sentences-test.mjs`, `tests/sentence-onsets-test.mjs`, plus `tests/seek-test.mjs` and `tests/audio-analysis-test.mjs`.

## `splitSentences(text)` → `[{ text, at }]`

`at` is the character offset where the sentence starts; the texts join back to the original. A sentence ends at `.`, `!`, `?` or `…` (runs of them, and a closing quote or bracket, stay with it). A piece is **merged into the previous sentence** when the previous one ends in an abbreviation (`Mr.`, `Dr.`, `Prof.`, `vs.`, `etc.`, `e.g.`, `i.e.`) or a single letter (an initial), or in a digit followed by a digit (`3.5`). One consequence: `"Plan A. Then plan B."` is one sentence. Empty or missing text gives one empty sentence, so there is always at least one.

## `paragraphIndexAt(segs, t)`

The line a time belongs to: the last line whose `start` is at most `t + 0.05` s. Before the first line, or with no lines, it is `-1`.

## `alignWords(textWords, timed)` → `number[]`

The transcript's words never read exactly like the aligner's (different models, the clean view, edits), so they are matched like a spelling diff (Levenshtein). Comparison ignores case and punctuation. A match costs 0, a different word starting with the same letter 1, any other substitution 1.5; skipping a word costs 1. The result has one entry per text word: the index of the matched timed word, or `-1`. Words that only pair up at cost 1.5 are left unmatched.

## `sentenceOnsets(sentences, timed)` → `[seconds | null, …]`

One start per sentence: the start of its first matched word. If its first words were not matched, the next matched word's start is used, moved earlier by 0.25 s for each word skipped. A sentence with no matched word, or no timed words at all, gives `null`.
