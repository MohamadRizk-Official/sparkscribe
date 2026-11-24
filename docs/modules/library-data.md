# Library data layer (`src/lib/library.js`)

Listing, search, favourites, folders ("courses" in the interface), course exam dates and a few display helpers for the Library, the home dashboard and the recording page. Every call runs **as the signed-in user** through Supabase: Row Level Security decides what exists for them, and the database functions `library_list`, `search_library` and `library_stats` are `SECURITY INVOKER`, so they see exactly the same rows. No AI is used here. Callers: [library-page.md](library-page.md), [dashboard.md](dashboard.md), [exam.md](exam.md).

Errors from Supabase are thrown as they are (`raise`), except the folder ones below, which are turned into plain sentences.

## Recordings
| function | what it does |
|---|---|
| `listLibrary({ view, type, folder, since, sort, offset, limit })` | one page via `library_list`. `view`: `all`, `favorites`, `recent`; `sort`: `newest`, `oldest`, `longest`, `shortest`, `az`, `recent`. Returns `{ rows, total }`. `total` is read from the first row; with no rows it is `0` on the first page and `null` on a later page (unknown) |
| `searchLibrary(query, { offset, limit })` | `search_library`: matches titles, transcripts, speaker names and labelled Notes; each result carries its matching lines with timestamps. Snippets mark matches with the control characters `\u0002` … `\u0003` (turned into `<mark>` by `highlight`) |
| `libraryStats()` | counts for the header. "This month" starts on the first day of the **user's own** month (local time, not UTC). With no row it returns zeros |
| `renameTranscript(id, title)` | trims and cuts the title to 300 characters. An empty name throws "The name can't be empty." (before any request). If no row was updated it throws "This recording no longer exists in your library." Returns the saved title |
| `setFavorite(ids, value)` | `ids` may be one id or a list; `value` is coerced to a boolean |
| `deleteTranscripts(ids)` | deletes and returns how many rows went; the original audio kept **on this device** for those recordings is deleted too (`deleteAudio`, see [audio-store.md](audio-store.md)) |
| `markOpened(id)` | sets `last_opened_at` (this is what "Recent" and Continue Studying use). Fire-and-forget: a failure never blocks opening a recording |
| `getRecordingMeta(id)` | `{ isFavorite, folderIds }` for one recording, or `null` |

## Folders (courses)
| function | notes |
|---|---|
| `listFolders()` | `{ id, name, count }` ordered by name |
| `createFolder(name)`, `renameFolder(id, name)` | names are trimmed. Database error `23505` becomes "You already have a course with that name."; `23514` becomes "Course names need 1–80 characters." |
| `deleteFolder(id)` | removes the folder and its memberships **only**; recordings are never deleted with a folder |
| `addToFolder(folderId, ids)` | upsert on `(folder_id, transcription_id)` ignoring duplicates, so adding twice is harmless |
| `removeFromFolder(folderId, ids)` | removes the memberships |
| `courseLectureIds(folderId)` | up to 200 recording ids, newest membership first |

## Course exams
`listCourseExams()` returns `Map(courseId → { date, topics })`, or **`null`** when the database does not have the exam columns yet (error `42703` or `PGRST204`); callers treat `null` as "exams are not offered". `setCourseExam(id, { date, topics })` stores the date (or `null`) and the topics (trimmed, at most 1000 characters, or `null`); a database check failure (`23514`) becomes "Pick a date between 2020 and 2100, and keep the topics under 1000 characters."

## Display helpers (pure)
- `highlight(snippet)`: escapes `& < > " '` and only then turns the `\u0002` / `\u0003` markers into `<mark>` / `</mark>`, so a snippet is safe to put in `innerHTML`.
- `fmtHours(seconds)`: under an hour "N min"; from one hour up to 10 hours one decimal ("2.5 hours"); otherwise whole hours.
- `PAGE_SIZE = 24`, `SEARCH_PAGE_SIZE = 10`.

Tests: `tests/library-helpers-test.mjs` (the display helpers). The data calls need a Supabase project and are not exercised by `npm test`.
