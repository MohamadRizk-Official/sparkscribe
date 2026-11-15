# Model-file cache (`src/engine/model-cache.js`)

The Cache Storage backend handed to transformers.js (`env.customCache`). Covered indirectly by `tests/model-cache-test.mjs`.

## Why it exists
Chromium (Chrome, Edge) refuses a single cache entry larger than 256 MiB, so the 353 MiB Whisper large-v3-turbo encoder
was never stored and was downloaded on every visit. Large files are therefore split.

## How it stores a file
- Files up to `PART_BYTES` (128 MiB) are stored as one ordinary entry, exactly as before. Entries written by older
  versions keep working.
- Larger files are stored as `ceil(size / PART_BYTES)` parts. Each part's key is the file URL plus a
  `sparkscribe-part=<i>` query parameter (`&` if the URL already has a query), because Cache Storage ignores fragments.
- A small **index entry** under the plain URL is written **last**. It has an empty body and carries two headers:
  `x-sparkscribe-parts` (number of parts) and `x-sparkscribe-size` (total bytes).
- Before writing parts, any old entry for the key is deleted so an old index never points at new parts.

## How it reads a file
`match` returns the plain entry if it has no parts header. Otherwise it reads every part and joins them. It returns
`undefined` (the file is downloaded again) if any part is missing or the joined size differs from the index. The
internal headers are removed from the returned `Response`, which gets a correct `content-length`.

## Failure behaviour
`chunkedCache()` wraps the real cache so a broken Cache Storage (damaged profile, full disk) never fails a
transcription: a failed `match` counts as "not cached", a failed `put` is skipped, a failed `has` returns `false`.
`has` looks only at the entry or its small index; nothing is read into memory.
