# SparkScribe QA cycle — progress log

Branch: `qa/v1-release` (from `release/v1-speakers` 423b06b). Nothing pushed, merged or deployed.
Evidence labels: **tested** (executed, result observed) · **simulated** (mocks/fixtures) · **inspected** (code read only) · **not verified**.

## Verified baseline (2026-10-12)
- main = origin/main = 95bf377 · release/v1-speakers = origin = 423b06b
- v1 engine: src/engine/diarize.js blob 7ce03f9 (== 92b1b5f); release app code == 92b1b5f

## Phases
| # | Phase | Status |
|---|---|---|
| 0 | Branch, references, progress file | done |
| 1 | Audit: feature inventory, risk ranking | done |
| 2 | Automated regression suite (unit/integration, mocks) | in progress |
| 3 | Browser end-to-end (local build, mocked backend) | in progress |
| 4 | Speaker display layer (line merging) investigation | pending |
| 5 | Performance and model caching | pending |
| 6 | Security and privacy audit | pending |
| 7 | Fixes + regression reruns | pending |
| 8 | Final report | pending |

## Audit (phase 1) — sources: 3 read-only code audits + my own measurements
Feature inventory: home (upload/process/result/save), Library (list/search/folders/favorites/bulk), transcript page
(speaker rename/move, Details, type, Clean view, Summary/Notes/Ask/Create incl. Action Plan, export), Settings, Auth.
Highest-risk journeys: save/sync of transcripts (data integrity) · auth redirects · AI cost exposure · model loading/caching ·
speaker corrections persisting · exports.

## Defects (triage; status: suspected → reproduced → fixed → verified)
| ID | Sev | Area | Defect | Status |
|---|---|---|---|---|
| D1 | **P1** | save | "New" during "Saving…" carried the old save id into the next run → the next transcript OVERWROTE the earlier recording (reproduced: row text replaced, version 1→2, second recording never saved) | **fixed + verified** (e2e) |
| D2 | P2 | save | edits made while the first save is in flight were never synced | **fixed + verified** (e2e) |
| D3 | P2 | results | 900 ms results timer not cancelled on reset → results re-opened over the drop panel (reproduced) | **fixed + verified** (e2e) |
| D4 | **P1** | auth | open redirect: `next=%2F%09%2Fevil.com` passed safeNext and resolved to evil.com (reproduced) | **fixed + verified** (e2e: crafted link lands on /, /library still works) |
| D5 | **P1** (public launch) | AI cost | no per-user rate limit or quota on AI endpoints | **prepared, OFF by default** — AI_HOURLY_LIMIT budget (counts the user's AI work in the last hour via RLS; cached results always served); enabling = entitlement change → **needs approval** (tests/ai-limits-test.mjs) |
| D6 | P2 | perf | 370 MB Whisper encoder exceeded Chromium's 256 MiB Cache Storage entry cap (measured: 255 MiB ok, 257 MiB refused) → re-downloaded on EVERY page load (+368 MiB per reload+run); UI claimed the model was saved | **fixed + verified** (real models: after reload +0.2 MiB, Get ready 8.4 s → 4.2 s) |
| D7 | P2 | perf | "New file" terminated the worker → models reloaded for every new file | **fixed + verified** (real models: Get ready ~0 s, 13–15 s → 8.2 s per short file; transcript identical) |
| D8 | P2 | data loss | "New file" / leaving the page discarded an unsaved transcript with no warning; pending edits dropped on New | **fixed + verified** (e2e: confirm dialog, beforeunload, pending sync flushed) |
| D9 | P2 | a11y | file picker not reachable by keyboard (label wraps hidden input, no tabindex) | suspected |
| D10 | P2 | transcript | short speaker turns dropped (MIN_TURN 0.3 s, single low-confidence word, "Thank you"/"you" filter, empty first pass never retried) → words lost; seen at 9:37 in the 23-min test | **reproduced** (data) |
| D11 | P2→P3 | AI | users can write AI result columns (content/status/source_version) → forge their own results; grade endpoint prompt was unbounded | grading prompt **bounded** (fixed + tested: 51 MB stored input → 3.4 KB prompt); column grants are by design (server writes AS the user); full fix = server-only writes (service role / SECURITY DEFINER) → **architecture change, needs approval** |
| D12 | P2 | UI | saved-page speaker edit not rolled back when save fails; type change error toast overwritten | suspected |
| D13 | P2 | UI | Summary "Update"/detailed retry fails silently | suspected |
| D14 | P2 | a11y | Space/arrow keys hijacked on results page while focus is on buttons | suspected |
| D15 | P2 | security | no security headers | **fixed (config)**: frame-ancestors none / X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy in vercel.json — verify on next Preview; full CSP proposed separately |
| D16 | P3 | export | a line containing a blank line split its subtitle cue (SRT/VTT corrupt); "-->" and VTT markup unescaped (reproduced on old code) | **fixed + verified** (tests/export-test.mjs 26/26) |
| D17 | P3 | XSS(self) | library type badge attribute and quiz score not escaped | **fixed** (inspected) |
| D18 | P3 | UI | `/^d+$/` regex → search-hit `line` param ignored | **fixed** |
| D19 | P2 | AI | a "generating" row could be taken over after 120 s while api/tools runs up to 300 s → duplicate paid generation | **fixed + tested**: takeover after 310 s (tools) / 75 s (insights, ask) |
| D20 | P1 | product | no delete-account / data deletion path | inspected (needs approval: auth/backend) |
Line-merging investigation: merging joins only SAME-speaker stretches; it never hides another speaker. All 4 of 33 marked
switches that lines scored worse than the engine come from dropped short turns (D10), not merging.

## Fixes applied
- F1 (D1, D2, D3, D8) src/main.js: save generation guard; edits during first save synced after it lands; results
  timer bound to its transcript; confirm before discarding unsaved results / stopping a long run; beforeunload
  warning; pending sync flushed on New. Evidence: qa/e2e/home-save.e2e.js 6/6 (4/5 failed before the fix).

- F2 (D4) src/lib/account.js safeNext: control chars refused, URL parser decides the origin. Evidence: qa/e2e/security.e2e.js 4/4 + live redirect check.
- F3 (D16, D17, D18) export.js cue text one line + VTT escaping; library badge + quiz score escaped; transcript `line` regex. Evidence: tests/export-test.mjs 26/26 (old code fails check 1).

- F4 (D6, D7) src/engine/model-cache.js (new): transformers.js custom cache over the same Cache Storage; files > 128 MiB
  stored as parts + index written last; damaged sets = cache miss. src/worker.js wires it; src/main.js keeps the worker
  on New (restarts only to stop a run or after an error). Evidence: qa/e2e/model-cache.e2e.js 6/6, home-save.e2e.js 8/8,
  real-model runs on the release build (network counter).

- F5 (D5 prepared, D11 partial, D19, audit #10 #11) server/ai/service.js: bounded grading prompt, optional hourly
  budget (off by default), takeover windows matched to function limits; server/db.js countRecentAiWork; server/http.js
  size limit + 400 on malformed bodies when the platform pre-parsed them; anthropic.js no provider error text to client.
  Evidence: tests/ai-limits-test.mjs 13/13, tests/http-test.mjs 8/8.
- F6 (D15) vercel.json security headers.

## Test infrastructure (in repo)
- qa/harness/dev-mock.mjs — real app + real /api code, fake signed-in user, in-memory DB, mock AI (port 5190)
- qa/harness/browser-mock.js — Supabase REST/RPC/auth mock, knobs (save delay/failure), fake worker (canned lines)
- qa/e2e/lib.js + *.e2e.js — in-page tests: `(await import('/qa/e2e/<file>')).run()` on http://127.0.0.1:5190

## Blocked / not verifiable
(none yet)

## Resource use
- Real AI calls: 0 (budget: ≤ 10 Haiku calls, ≤ $0.05)
- Model downloads: 0 (models already cached in the in-app browser origin 127.0.0.1:4312 only)
