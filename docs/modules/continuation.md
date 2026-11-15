# Sentence continuation marks (`src/lib/continuation.js`)

`continuationMarks(lines)` returns `[{ cut, cont }]`, one per line, so the page can show "…" where a sentence is split
by a speaker change. Display only: words, order and speakers are never changed. Test: `tests/continuation-test.mjs`.

Line `i-1` is marked `cut` and line `i` is marked `cont` only when **all** hold:
- the speakers differ;
- the lines touch: `|b.start - a.end| ≤ 0.05` s;
- the earlier line does **not** end a sentence (`. ? ! …`, optionally followed by quotes or closing brackets);
- the later line starts with a lower-case ASCII letter (`/^[a-z]/`).

Text is trimmed before checking. Input is `[{ start, end, speaker, text }]` in order; the first line is never `cont`.
