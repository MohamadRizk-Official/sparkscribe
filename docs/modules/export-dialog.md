# Export builders and dialog (`src/insights/export.js`)

Everything that turns saved material into a downloadable file. The file is built **in the browser** from data already loaded for the signed-in user (RLS decided what that is), so there is no export URL anyone could guess. No AI is involved. The PDF and Word libraries (`jspdf`, `docx`) are loaded with dynamic `import()` only when those formats are used. Where the blocks of a Create tool come from: [create-export-text.md](create-export-text.md).

## The document shape
```
doc = { title, meta: [line], sections: [{ heading, blocks: [{ t, text, time? }] }] }
t = 'h' | 'p' | 'li' | 'quote' | 'meta' | 'pre'      time = seconds into the recording (optional)
```

## Builders
| function | output | notes |
|---|---|---|
| `toText(doc)` | plain text | section headings upper-cased and underlined with `=`, block headings with `-`; a block with a time gets `[m:ss]` appended; more than one blank line in a row is collapsed; ends with one newline |
| `toMarkdown(doc)` | Markdown | title `#`, sections `##`, block headings `###`, list items `-`, quotes `>`, times in italics `*(m:ss)*`. Only characters Markdown would turn into formatting are escaped (including a leading `1.` or `#`) |
| `toDocx(doc)` | `Blob` | title, italic grey meta lines, headings, bullets, times in teal; uses the `docx` library |
| `toPdf(doc, info, { fetchFont })` | `Blob` | A4, 56 pt margins, headings never left alone at the foot of a page |
| `toSrt(segments)`, `toVtt(segments)` | subtitle text | see below |
| `fileBase(...parts)` | file name stem | accents stripped, anything else non-alphanumeric becomes `-`, at most 90 characters, falls back to `SparkScribe-export` |

`FORMATS` lists the six formats (`pdf`, `docx`, `md`, `txt`, `srt`, `vtt`) with label, extension and MIME type; `srt` and `vtt` carry `subtitles: true`.

### PDF and non-Latin text
The built-in PDF fonts cover only Latin text. If the document contains characters outside them, `toPdf` fetches Noto Sans (regular and bold, from `/fonts/`) and embeds it; the subset in `pdf-font-coverage.js` says which characters that font can show. `info.unicode` reports whether the embedded font was used. If the font can't be fetched (offline) it falls back to the built-in fonts and unsupported characters are printed as `?`; `info.replaced` counts them so the dialog can tell the user. The embedded font has no italic, so italics are dropped there.

### Subtitles
Cues come only from real line timestamps and are built so the file cannot be corrupted by its content:
- lines that are blank after trimming are skipped;
- a cue ends at its own end time, but never after the next cue starts, and never shorter than 0.2 s; a line with no usable end (zero or negative length) gets a 2 s cue;
- the text is one line: line breaks become spaces and a literal `-->` becomes `->`;
- the speaker is prefixed (`Maya: …`) unless it is empty or `Unknown`;
- SRT numbers cues from 1 and uses `,` before milliseconds; VTT starts with `WEBVTT`, uses `.`, and escapes `&`, `<` and `>` in the text.

## `openExportDialog({ title, meta, sources, segments, coarse, preselect, onDone })`
A modal dialog: checkboxes for **what** to export (`sources`, grouped, only those that are `ready`; ones not created yet are listed as such) and radio buttons for the **format**.

- At least one thing must be chosen ("Choose at least one thing to export").
- **Subtitle formats are enabled only** when the original transcript is the only thing selected, the recording is not `coarse` (saved before line timestamps existed, where timing would be invented) and there are segments. Otherwise they are greyed out with the reason, and a previously chosen subtitle format switches back to PDF.
- The file is named `fileBase(title, label)` plus the extension (the transcript's label is shortened to `Transcript`). With one source the document title is "<title> — <label>"; with several, just the title and one section per source.
- A failure shows "That export didn't work. Try another format." and re-enables the button. After a PDF that had to replace characters, `onDone` receives a message suggesting Word or text, which keep them.

Tests: `tests/export-test.mjs` (every format, Unicode, special characters, long transcripts, subtitle timing) and `tests/export-doc-builders-test.mjs` (small documents, file names, time formats). The dialog itself is browser-only.
