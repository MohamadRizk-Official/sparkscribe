# Saving transcripts (`src/lib/transcripts.js`)

How a finished transcript is stored for a signed-in user, and how one made *before* signing in is carried across the sign-in. Every query runs **as the signed-in user**: Row Level Security decides which rows exist for them, and `user_id` is never sent from the browser (the database fills it from `auth.uid()`). Listing, searching, folders and favourites live in [library-data.md](library-data.md); the display helpers at the bottom of the file are shared by the Library and the recording page.

## Functions
| function | what it does |
|---|---|
| `saveTranscript({ id, title, durationSeconds, language, text, segments, recordingType })` | inserts one row in `transcriptions` with status `completed` and returns its id (see "Safe to retry") |
| `updateTranscriptText(id, text, segments)` | speaker renames and reassignments. `segments` is only sent when given. Throws "This transcript no longer exists in your library." if no row was updated. The database bumps `content_version` when text or segments change, which marks summaries made from the old text as out of date |
| `updateRecordingType(id, recordingType)` | changes only the type |
| `listTranscripts()` | newest first, at most 500, **without** the transcript text (only `id, title, status, duration_seconds, language, recording_type, created_at`) |
| `getTranscript(id)` | the whole row, or `null` when it does not exist or is not yours |
| `deleteTranscript(id)` | deletes the row, then the original audio kept on this device ([audio-store.md](audio-store.md)). Throws "This transcript couldn't be deleted (it may already be gone)." if nothing was deleted |

### What a saved row contains
- `title`: the given title cut to 300 characters, or "Untitled transcript" when blank.
- `duration_seconds`: rounded to a whole number, or `null` when it is not a finite number.
- `language`, `recording_type`: `null` when not given. `segments`: `null` when not given.

## Safe to retry
The page chooses one id per transcript (`crypto.randomUUID`) and passes it as `id`. If the connection drops after the database stored the row but before the answer arrived, the retry hits a duplicate key (`23505`). The code then looks the id up: if the row is there it counts as saved and returns that id (so the minutes are not counted twice); if it is not there (someone else's id) the duplicate error is thrown.

A database without the launch-integrity migration refuses client-chosen ids with a permission error (`42501` / "permission denied"). That one case is retried once **without** an id. Any other error with an id is thrown straight away, with no second attempt.

## Hand-off when someone signs in after transcribing
The transcript text is private and may sit on a shared computer, so the parked copy is handled carefully:

| function | behaviour |
|---|---|
| `stashPending(payload, owner)` | stores `{ ...payload, owner, at }` in `localStorage` under `sparkscribe.pendingSave`. Returns `false` if storage is blocked |
| `peekPending()` | returns it, **unless** it is older than one hour (then it is removed, with its parked audio, and `null` is returned) or the stored text is damaged (`null`) |
| `clearPending({ keepAudio })` | removes it. The parked audio goes too unless `keepAudio` is set (the page is about to re-key that audio to the saved recording) |

`owner` remembers which account made the transcript (or `null` if nobody was signed in), so it is only offered back as a Save / Discard choice right after the "sign in to save" round trip, never saved into whoever signs in next. Signing out clears it ([account.js](../../src/lib/account.js) `signOut`).

## Display helpers
- `fmtDuration(seconds)`: `m:ss`, or `h:mm:ss` from one hour; `—` for `null`/`undefined`.
- `fmtDate(iso)`: "Oct 17, 2026 · 3:05 PM" in the reader's locale.
- `langName(code)`: English name of a language code ("fr" → "French"), the code itself if unknown, empty for no code.
- `parseTranscriptText(text)`: reads the `.txt` export format (`[0:14] Speaker 1:` followed by lines of text) into `[{ time, speaker, text }]`.

Tests: `tests/transcripts-data-calls-test.mjs` (requests, retry safety, hand-off), `tests/transcripts-helpers-test.mjs` and `tests/transcripts-format-edges-test.mjs` (display helpers). How the tests stand in for Supabase: [../testing/stand-ins.md](../testing/stand-ins.md).
