# Joining overlapping chunks (`src/engine/merge.js`)

Long recordings are transcribed in chunks where chunk B starts about one second before chunk A ends, so a few words
are transcribed twice. `mergeOverlap(aText, bText, maxWords = 12)` finds the repeated words and removes them from B.
Covered by `tests/merge-overlap-test.mjs`.

## Result
`{ a, b, removed }`: both texts trimmed and split into words, `b` without the repeated start, `removed` the number of
words dropped (0 when nothing was found).

## How a match is decided
Words are compared after lower-casing, Unicode normalisation (NFKC) and stripping everything except letters, digits
and apostrophes. The search goes from the longest candidate (up to `maxWords` or the shorter text) down to 1 word:

| overlap | accepted when |
|---|---|
| exact | 2 or more words, or a single word of 4 or more letters |
| near-exact | 4 or more words with at most one mismatched word |

Short single-word matches (`on`, `so`) are ignored, because they are usually coincidence rather than overlap.

## Cut-off word
If A ends in a fragment of 3 or more letters (`the budg`) and B starts with a word that begins with it (`budget is`),
the fragment is dropped from A and B is kept whole (`removed` is 1).

## Empty input
If either side has no words, both are returned trimmed and `removed` is 0.
