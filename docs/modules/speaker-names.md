# Speaker names in AI results (`src/lib/speaker-names.js`)

Summaries, notes, answers and Create results quote speakers by the name they had when the result was made, usually
`Speaker 1`. Each stored segment keeps its original label (`orig`, see `src/lib/segments.js`), so after `Speaker 1` is
renamed to `Hadi` those results can say `Hadi` too, without regenerating them or touching transcript words.
Reassigned paragraphs still mark results out of date (`content_version`), because there the facts changed, not just
a name. Covered by `tests/speaker-names-test.mjs`.

## `nameMapFromSegments(segments)`
Returns `Map(original name -> current name)`. A rename is included only when it is unambiguous:
- segments with no `orig`, an `orig` of `Unknown`, or no current `speaker` are ignored;
- the most common current name must cover **at least 70%** of that speaker's lines;
- the name must differ from the original and not be `Unknown`.

## `renameInText(text, map)`
Plain-text replacement for exports and copies. Whole names only: `Speaker 1` does not touch `Speaker 10` or a name
glued to letters or digits. Longer names are matched first, regex characters in names are matched literally.
An empty map returns the input unchanged.

## DOM helpers (not unit-tested, need a browser)
- `applyNames(root, map)` rewrites text nodes under `root`, skipping `.transcript`, inputs, textareas and `[data-keep-names]`.
- `watchNames(root, getMap)` re-applies on every DOM change using a `MutationObserver`.
