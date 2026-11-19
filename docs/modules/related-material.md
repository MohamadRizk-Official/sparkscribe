# Related material placeholder (`src/lib/related-material.js`)

The "Add slides or PDF" entry point. It is **not live**: nothing is uploaded or read. Covered by
`tests/related-material-brand-test.mjs` (markup only).

- `relatedMaterialHtml(mode)` returns a `[data-related]` row with a button, the text "PowerPoint · PDF · optional" and a
  "Coming soon" tag. The button label is "Add slides or PDF" for `mode === 'processing'` (while a recording is being
  transcribed) and "Add related material" otherwise (a finished recording).
- `bindRelatedMaterial(root)` makes each `.related-add` button toggle a small details popover (`details-pop.js`)
  titled "Slides and PDFs · coming soon". It explains the plan: add lecture slides or a PDF, Notes/Ask/Quiz/
  Flashcards/Study Guide use both, sources read like "Recording · 24:18" and "Slide 14", and files are read on the
  device like audio. It tolerates a missing `root`.
- When the feature ships, this file and the "Coming soon" copy are the places to change.
