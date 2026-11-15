# Ask answer rendering (`src/insights/answer-format.js`)

Turns the model's answer text into safe HTML with numbered citations. Test: `tests/ask-format-test.mjs`.

## Safety
Every character is HTML-escaped first; only a fixed set of tags is produced. No links (`[text](url)` keeps just the
text), no images, no raw HTML, no attributes taken from the text.

## Supported Markdown subset
Headings (`#`/`##` → `h4.aa-h`, deeper → `h5`), paragraphs, `**bold**`/`__bold__`, `*italic*`/`_italic_`, `` `code` ``,
`-`/`•`/`*` lists, `1.` / `1)` numbered lists (keeps the start number), one level of indented sub-items, `>` quotes,
pipe tables (header, separator row, rows padded to the header width, wrapped in a focusable region), and `---` rules
(which only end a list).

## Citations
`extractCitations(text, isValid)`: `[12]`, `[12][15]` and `[12, 15]` are one cluster = one claim's sources. Ids failing
`isValid` are dropped; a cluster with none left disappears. Clusters are numbered `[1]`, `[2]`… in reading order, and the
same set of lines gets the same number. Numbers derive from the stored text only, so a reopened answer shows the same
numbers. Spaces before punctuation or a marker are tidied.
`renderAnswer(text, { isValid, cite })` returns `{ html, groups }`; `cite(group)` supplies the HTML per marker, which is
wrapped with the preceding word in an unbreakable `span.aa-nw`.

## Other helpers
`bestExcerpt(lineText, claim, max = 240)`: a short line is returned whole; otherwise the sentence sharing the most
non-stop-words with the claim is grown outward while it fits, with `…` marking cuts. `claimBefore(markerEl)` (browser
only) returns the sentence before a marker.
