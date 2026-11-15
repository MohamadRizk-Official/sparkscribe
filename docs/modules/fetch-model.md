# Checked model downloads (`src/engine/fetch-model.js`)

For model files the app loads itself (not through transformers.js), such as the second speaker model.

`cachedModel(url, sha256, { onProgress })` → `ArrayBuffer`:
1. If Cache Storage (`sparkscribe-models`, via `model-cache.js`) has the URL, read it and compare its SHA-256. A match is
   returned; a mismatch or any read error falls through to a fresh download.
2. Download with a streaming reader. `onProgress` gets `{ status: 'progress', file, loaded, total, progress }` per chunk
   (`progress` is 0–100, 0 when the size is unknown) and `{ status: 'done', file }` at the end.
3. The result is hashed; if it differs from `sha256` the call throws `model file <name> did not match its checksum`
   and **nothing is cached**. A non-OK response throws `model download failed (<status>)`.
4. The buffer is stored in the cache; a failure to store (full disk) is ignored.

`prefetchModel(url, sha256, opts)` does the same but returns immediately if the cache already has the entry (`has`),
without reading it into memory. Used during "Get ready".

If `caches` does not exist (plain Node), the cache is skipped and every call downloads and verifies.
