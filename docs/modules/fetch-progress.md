# Stall-aware downloads (`src/lib/fetch-progress.js`)

Test: `tests/fetch-progress-test.mjs`.

## `fetchBlobURL(url, type, { stallMs = 30000, onProgress, fetchImpl })`
Downloads into a `blob:` URL. A timer is re-armed before every read; if no bytes arrive for `stallMs` the download is
aborted and a `StallError` ("The download stopped. Check your connection and try again.") is thrown. A slow but moving
connection is never cut off. `onProgress(got, total)` is called per chunk (`total` is 0 when unknown). A non-OK
response throws `Download failed (<status>).`. Without `body.getReader` the whole body is read at once.
A cancelled read that reports `done` is not mistaken for a complete download: the abort reason is thrown instead.

## `withTimeout(promise, ms, message, onTimeout)`
Rejects with `StallError(message)` if the promise has not settled in `ms`. The promise keeps running; `onTimeout` can
stop it. The timer is cleared when the promise settles.
