# Audio kept on this device (`src/lib/audio-store.js`)

The original recording is stored in the browser's IndexedDB (database `sparkscribe-audio`, store `audio`), keyed by the recording's id. It never goes to Supabase or any bucket. Transcript timestamps were made from the same file, so playback lines up without re-transcribing. Covered by `tests/audio-store-test.mjs` (the parts that run without IndexedDB).

## Best effort
Everything resolves quietly when storage is missing, blocked or full: writes report `false`, reads find nothing, and the transcript page offers "Attach original audio". Nothing in the app depends on a call here succeeding.

## Keys
- The recording id (uuid) once saved.
- `pending` (`PENDING_AUDIO_KEY`) while a recording is transcribed before sign-in. `rekeyAudio(from, to)` moves it to the real id after saving. `pending` is not counted in `audioStorageInfo().count`.

## Stored record
`{ blob, name, type, size, savedAt, env?, align? }`
- `env`: the loudness envelope (`lib/breath.js`) so links start in a pause (`putEnvelope`).
- `align`: word timings for sentence clicks (`putAlign`, `lib/sentence-timing.js`).
- `putEnvelope` and `putAlign` only work on audio that is already stored.

## Preference
`keepAudioPref()` reads `sparkscribe.keepAudio` from localStorage: on unless the value is exactly `"0"` (also on when localStorage is unavailable). `putAudio` stores nothing when it is off, or when the key or file is missing or empty. Asks the browser (once) to protect the storage from automatic eviction.

## `fmtBytes(n)`
`0` or missing → `0 MB`; under 1 MB → `N KB` (at least 1); under 10 MB → one decimal MB; under 1 GB → whole MB; above → two decimal GB.
