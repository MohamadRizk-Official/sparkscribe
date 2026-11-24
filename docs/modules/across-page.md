# Across recordings page (`src/pages/across.js`)

`/across`: **Ask across recordings** and the **combined study guide** (Thunder). The server side is [across-ask.md](across-ask.md) and [across-guide.md](across-guide.md); how `{{R2}}` and `{{R2.S1}}` references are shown is [across-refs.md](across-refs.md). This page only collects the selection, calls the server and shows what comes back.

## The selection lives in the URL
`?ids=<uuid>,<uuid>…` (plus `&tab=guide` for the guide tab) so a reload or a bookmark keeps it. `readUrl` keeps only well-formed UUIDs, removes duplicates and keeps **at most 12** (`ASK_MAX`). The page asks for **at least 2** (`MIN`); a combined study guide takes **at most 10** (`GUIDE_MAX`) and says "Too many for one study guide" otherwise (an existing saved guide is still shown). The Library sends people here with up to 12 selected ids ([library-page.md](library-page.md)).

Recordings are read as the signed-in user (Row Level Security). An id that isn't theirs, or was deleted, simply doesn't come back; `setIds` drops it and tells the user. Recordings are listed oldest first, which is also how the model labels them (R1, R2, …).

## Always the server's copy
Answers and guides are saved to the account **by the server** as they are made, so the page shows the server's thread for the current selection (`acrossThread`) and the history of earlier selections (`acrossHistory`), never a copy of its own. It reloads quietly when the tab becomes visible again, on window focus and when the connection returns, at most once every 5 seconds and never while an answer or guide is being made. Saved work is shown with the recordings' **current** titles and speaker names; a deleted recording, or one whose text was edited since, is flagged (`staleNote`) instead of silently pointing at the wrong place (a rename doesn't count: names are always current).

## Plans
Asking and making guides need Thunder; saved work stays readable on every plan. The server enforces it ([entitlements.md](entitlements.md)); the page only explains. Without the capability a locked panel links to the pricing page with Thunder highlighted and the current selection as the return path. If the plan can't be determined (`myPlan()` fails) the forms stay and the server's answer decides. A `plan_required` error from the server refreshes the plan and shows the upgrade message.

## Ask
1. `prepareSummaries`: recordings that have no summary yet are read once first (`requestInsight(id, 'overview')`), with a "Reading recordings for the first time (i of n)" status. Each summary is saved with its recording, as on its own page. A failure here is ignored: the answer can still use its passages.
2. `askAcross` streams the answer. Citations like `[R2:45]` become links to that passage in that recording (`richAnswer`, `chipFor`) and a sources list.

## Combined study guide (`makeGuide`)
The guide is built from each recording's **study map**. If some recordings don't have one yet the server answers `needs_maps` with the list; the page makes them one at a time with `requestTool(id, 'study_guide')` ("Making a study map for … (i of n)"), then asks again. It retries the guide request only **once**. If another tab is already generating a map, the page polls (every 4 s, up to 30 times) instead of paying twice. If the server reports missing recordings (`not_found`) they are removed from the selection. A guide that could not be saved to the account is shown with a "copy it to keep it" notice.

Browser-only: no automated test of its own. The pieces it relies on that are tested: `tests/across-refs-helpers-test.mjs`, `tests/across-test.mjs`, `tests/across-history-test.mjs`, `tests/across-guide-grounding-test.mjs`.
