# Library page (`src/pages/library.js`)

`/library` is the signed-in student's personal archive: **Recent / All / Favorites / Folders** (shown to students as *Courses*), filters, sorting, search across every transcript with timestamps, favourites, course folders, rename and bulk actions. Data arrives a page at a time through `src/lib/library.js`; nothing on this page calls an AI service. Dialogs (rename, confirm, folder picker, toast) come from `src/library/dialogs.js`.

## State lives in the URL
The page's whole view state (`st`) is mirrored in the query string, so Back, reload and sending a link to yourself work. `readUrl` validates every value and falls back to a default when it is unknown; `writeUrl` writes only values that differ from the defaults and fires `sparkscribe:route` so the header can mark Library or Courses.

| parameter | accepted values | default (not written) |
|---|---|---|
| `view` | `recent`, `all`, `favorites`, `folders` | `all` |
| `folder` | a 36-character id (hex and dashes); also forces `view=folders` | none |
| `type` | `lecture`, `meeting`, `voice_message`, `interview`, `podcast`, `general` | none |
| `date` | `7`, `30`, `365` (days) | none |
| `sort` | `newest`, `oldest`, `longest`, `shortest`, `az` | `newest` |
| `q` | search text, cut at 200 characters | none |

`refresh({ push })` is the single entry point after any state change: write the URL, redraw the header controls, then run a search, load the folder overview, or load a page of recordings.

## Three kinds of screen
1. **Recordings list** (`loadRows`): a page of `PAGE_SIZE` (24) rows. "Recent" uses the `recent` sort (most recently opened); a folder shows its recordings as an "all" list. The list is finished when a page comes back short or the known total is reached. Load-more appends.
2. **Folders overview** (`loadFolders` / `renderFolders`): the student's courses with counts and their accent colours (`courseTone`).
3. **Search** (`runSearch`): used when the trimmed query has **2 or more characters** (`searching()`). It returns `SEARCH_PAGE_SIZE` (10) results at a time, each with highlighted snippets and timestamps that jump into the recording at that moment. A first page with results sends the mascot a `search-found` signal.

### Out-of-order responses
Every load increments a module-level `token`; a response whose token is no longer current is discarded. Typing quickly or switching filters therefore can't paint stale rows. Errors show a "Couldn't load your library" / "Search didn't work" panel with a Try again button.

## Selecting and bulk actions
`setSelecting` turns on selection mode; the bulk bar offers (via `bulk(action)`):
- **Favourite**: if every selected row is already a favourite it removes them, otherwise it adds them.
- **Courses**: opens the folder picker for the selected ids.
- **Delete**: asks for confirmation (`confirmDeleteRecordings`), deletes, refreshes the stats.
- **Across recordings / combined guide**: navigates to `/across?ids=…` with at most the first **12** ids (add `&tab=guide` for the guide). Those features belong to Thunder (see [across-ask.md](across-ask.md)); a plan check happens on the destination.
- **Cancel** leaves selection mode.

After any change the page leaves selection mode and calls `refresh()`.

## Per-recording actions
A menu on each row (rename inline, star, add to a course, delete), `renameRow`, `toggleStar`, and `addRecordings` for putting existing recordings into the current course. Course actions on a folder view: rename and delete the course (recordings are kept; they just leave the course).

## Empty states
`EMPTY` holds the wording for each situation (empty library, no favourites, empty course, nothing in the date range, no recordings of a given type). Where the table marks one with `true` it offers an upload shortcut.

Browser-only: no automated test of its own. The helpers `highlight` and `fmtHours` from `src/lib/library.js` are covered by `tests/library-helpers-test.mjs`.
