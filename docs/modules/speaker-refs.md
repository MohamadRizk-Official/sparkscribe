# Speaker references (`src/lib/speaker-refs.js`)

How AI results refer to speakers so that renaming a speaker never needs a regenerate. Pure functions (browser and server). Tests: `tests/speaker-names-test.mjs`, `tests/speaker-refs-render-test.mjs`, `tests/speaker-refs-orig-codes-test.mjs`, and checks in `tests/study-test.mjs` / `tests/service-test.mjs`.

## The idea

The model never writes a display name. It sees each speaker as a code (`S1`, `S2`, …) and writes `{{S1}}` where it refers to one. The stored result keeps the codes plus a table of which transcript lines each speaker said when it was made. When the result is shown, each code becomes the name those lines carry **now**:

- rename "Speaker 1" to "Professor Ahmad" any number of times and the new name shows;
- merge two speakers and both codes show the merged name;
- lines moved to `Unknown` show "an unidentified speaker";
- transcript words, quotes and evidence are never touched, and nothing is found by searching text for a name.

## Pieces

| function | what it does |
|---|---|
| `toRanges(ids)` / `fromRanges(ranges)` | `[12,13,14,20]` ⇄ `[[12,14],[20,20]]`, for compact line lists |
| `speakerTable(segments)` | `{ table, codeOf, shares }`: codes follow the order speakers first speak, `Unknown` gets none, `shares` is each code's share of the words |
| `dominantSpeaker(shares, 0.8)` | the code of a speaker who says at least 80 % of the words (a lecturer), else `null` |
| `codedLine(s, codeOf, clock)` | `[12] 3:41 S1: text`, what the model reads |
| `tokenizeSpeakers(value, codeOf)` | model output → stored form: `{S1}`, `[[S1]]`, bare `S1:` / `S1's` / `S1 said` / `by S1`, and written-out automatic labels ("Speaker 1") become `{{S1}}`. Fields named `quote`, `evidence` and `anchor` are left exactly as written. A name a user chose ("Grace") is never searched for |
| `speakerResolver(table, segments)` | code → the name most of that speaker's stored lines carry now; all lines `Unknown` → "an unidentified speaker"; lines gone → the name at generation; unknown code → "a speaker" |
| `renderSpeakers(text, resolve)` | replaces `{{S1}}` in a string (other values pass through) |
| `resolveContent(content, segments)` | the whole stored result with codes replaced; results without a `speakers` table are returned as they are |
| `hasTokens(s)` | true if a string contains a `{{S#}}` token |

## Fingerprint

`transcriptBasis(segments)` → `{ n, text, parts }`: line count, a hash of the words, and a hash of which lines share a speaker (names ignored). `sameBasis(a, b)` compares them. A rename or whitespace change keeps the basis; editing a word, reassigning a paragraph or merging speakers changes it, which is what marks saved results out of date.

## Ask answers

An Ask answer is stored as plain text with no table, so its codes follow each line's **original** label (`orig`, which survives every rename, merge or reassignment):

- `origCodes(segments)`: an automatic "Speaker N" is always `SN`, whatever the order now; any other original label takes the next free number; `Unknown` gets none.
- `origResolver(segments)`: code → the name most of that original speaker's lines carry now.
- `renderAskSpeakers(text, segments)`: swaps the codes and hides an unfinished `{{S` at the end of streaming text.

Cross-recording answers use the same codes scoped to a recording: [across-refs.md](across-refs.md).
