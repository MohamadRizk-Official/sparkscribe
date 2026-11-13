# References across recordings (`src/lib/across-refs.js`)

Stable references in answers and study guides made from several recordings (Thunder). Pure functions. Tests: `tests/across-test.mjs`, `tests/across-history-test.mjs`, `tests/across-refs-helpers-test.mjs`.

## Labels and tokens

The model sees each recording as a label (`R1`, `R2`, … oldest first) and each speaker as a code scoped to its recording (`R2.S1` = speaker `S1` of `R2`). The `S` number comes from the speaker's **original** label (see [speaker-refs.md](speaker-refs.md), `origCodes`), so "Speaker 1" of one recording is never confused with "Speaker 1" of another.

It writes `{{R2}}` or `{{R2.S1}}` where it refers to one. The stored result keeps those tokens and a snapshot of which recording each label was. Citations stay `[R2:45]`.

## Functions

| function | what it does |
|---|---|
| `acrossSpeakers(label, segments)` | `Map("R2.S1" → current name)` for one recording |
| `tokenizeAcross(text, { labels, speakers, titles, autoNames, names })` | model output → stored form (below) |
| `renderAcross(text, { title, speaker })` | stored form → shown text: `{{R2}}` becomes the recording's title **now**, `{{R2.S1}}` the speaker's name now; an unknown token shows "a recording" / "a speaker"; `{{R1}} (Oct 6)` collapses to the title when the title already says "Oct 6" |
| `renderAcrossStreaming(text, names)` | the same while an answer streams, with an unfinished token at the end hidden |
| `mapStrings(value, fn)` | applies `fn` to every string in a stored result except the snapshot / reference fields `sources`, `recordings`, `refs`, `key`, `label`, `transcriptionId`, `concept` (a skipped key protects a string or an array of strings) |

## What `tokenizeAcross` normalises

- `{R2}`, `[[R2]]`, `{{ R2 }}` and the speaker forms become `{{R2}}` / `{{R2.S1}}`; a label or code the model was not given becomes "a recording" / "a speaker";
- a bare `R2.S1` becomes a token when that speaker exists;
- `R1 (Lecture 2, Oct 1)` becomes `{{R1}} (Oct 1)`: the title the model repeated goes, extra detail stays;
- `Lecture 5 (R2)` becomes `Lecture 5`;
- a bare label becomes a token, but never inside a citation (`R2:45`), a concept reference (`R2.c5`) or an existing token;
- with `autoNames`, an automatic label ("Speaker 3") in a sentence that cites exactly one recording becomes that recording's speaker code; names users gave are never searched for;
- `Speaker {{R1.S1}}` loses the word "Speaker", and a name the model repeated in brackets right after its code is removed (needs `names`).
