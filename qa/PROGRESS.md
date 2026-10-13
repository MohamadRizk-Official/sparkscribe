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
| 2 | Automated regression suite (unit/integration, mocks) | done (143 unit) |
| 3 | Browser end-to-end (local build, mocked backend) | done (51 e2e + 5 on prod build) |
| 4 | Speaker display layer (line merging) investigation | done (D10) |
| 5 | Performance and model caching | done (D6, D7) |
| 6 | Security and privacy audit | done |
| 7 | Fixes + regression reruns | done |
| 8 | Final report | done — qa/REPORT.md |

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
| D9 | P2 (a11y) | home | the file picker (primary action) could not be reached by keyboard | **fixed + verified** (real Tab reaches the drop box, focus ring visible, Enter/Space open the picker; a11y.e2e.js) |
| D10 | P2 | transcript | short speaker turns dropped (MIN_TURN 0.3 s, single low-confidence word, "Thank you"/"you" filter, empty first pass never retried) → words lost; seen at 9:37 in the 23-min test | **reproduced** (data) |
| D11 | P2→P3 | AI | users can write AI result columns (content/status/source_version) → forge their own results; grade endpoint prompt was unbounded | grading prompt **bounded** (fixed + tested: 51 MB stored input → 3.4 KB prompt); column grants are by design (server writes AS the user); full fix = server-only writes (service role / SECURITY DEFINER) → **architecture change, needs approval** |
| D12 | **P1** | saved page | two quick speaker edits whose saves finished out of order left the OLDER state in the database while the screen showed the newer one (reproduced: screen "Ava Final", DB "Ava"); a failed save had no retry and was lost on reload | **fixed + verified** (e2e transcript.e2e.js 8/8: saves serialized with latest state, failed edit retried with next change, leave warning) |
| D13 | P2 | AI UI | a failed "Update" of a summary showed nothing; after reload the previous summary disappeared behind an error (server withheld content of failed insights and did not restore its version) | **fixed + verified** (insights.e2e.js 3/3, ai-limits-test.mjs: previous result + version kept, shown with the error) |
| D12b | P2 | UI | a failed recording-type change: error toast overwritten by "Type: …", page kept the unsaved type | **fixed + verified** (insights.e2e.js) |
| D14 | P2 (a11y) | results | Space/arrow keys were taken by the player even when focus was on a button, tab or radio | **fixed + verified** (a11y.e2e.js: Space reaches focused buttons; body still plays/pauses) |
| D15 | P2 | security | no security headers | **fixed (config)**: frame-ancestors none / X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy in vercel.json — verify on next Preview; full CSP proposed separately |
| D16 | P3 | export | a line containing a blank line split its subtitle cue (SRT/VTT corrupt); "-->" and VTT markup unescaped (reproduced on old code) | **fixed + verified** (tests/export-test.mjs 26/26) |
| D17 | P3 | XSS(self) | library type badge attribute and quiz score not escaped | **fixed** (inspected) |
| D18 | P3 | UI | `/^d+$/` regex → search-hit `line` param ignored | **fixed** |
| D19 | P2 | AI | a "generating" row could be taken over after 120 s while api/tools runs up to 300 s → duplicate paid generation | **fixed + tested**: takeover after 310 s (tools) / 75 s (insights, ask) |
| D21 | P2 | AI | Meeting Recap / meeting Notes listed a task completed during the call ("Send the price list") as an action item — a completed task presented as outstanding (real Haiku run) | **fixed + verified** (shared ACTION_RULE: leave out tasks done/cancelled/replaced later; re-run: gone from recap and notes; n=1 real run) |
| D22 | P2 (a11y) | Light theme | speaker names (and other speaker-coloured text) had 1.38–2.77:1 contrast in Light — the new default; speaker names measured 1.66:1 | **fixed + verified** (light-theme text mixes the hue 50% toward black: 5.0–8.1:1 for all palette colours; names measured 5.78–7.6:1) |
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

- F7 (D12, D12b, D13) src/pages/transcript.js save queue; src/insights/insights.js failed results keep previous content,
  type change rollback; server/ai/service.js + server/db.js failInsight keeps previous version, publicInsight returns it;
  toasts accept a duration (home toast gets role=status).

- F8 (D9, D14) index.html/src/main.js/src/style.css: drop box is a focusable button with focus ring; player shortcuts
  ignore focused controls, modifiers and open dialogs.

- F9 (D21) server/ai/prompts.js ACTION_RULE. AI grounding results (real model, scripted meeting with known answers):
  Action Plan 7/7 statuses right (open ×2 with deadlines, completed with resolution, discussed-only, cancelled, unclear,
  open decision); Ask: coffee = "not decided" (cited), off-topic refused (found=false), price = final 1.50 not the
  2.00 suggestion; Overview faithful; Recap decision = 1.50 only. Mock suites cover invented refs/quotes/evidence.

- F10 (D22) src/style.css light-theme text colour for speaker names/initials and coloured mock labels.
- Verified without change: RLS on all 12 tables, owner-only policies; simulated random signed-in user sees 0 rows /
  0 RPC results, anon has no privileges (read-only transactions, production). npm audit: 0 vulnerabilities.
  Mobile 375 px: Library, transcript page, speaker menu, Details fit; no horizontal scroll; dark contrast ≥ 6.75:1.

- Input edge cases (tested on a production build, real decode + real models): PDF, 0-byte .m4a, text renamed .mp3 →
  "Couldn't read …" in 0.2–0.4 s and Try again recovers; 0.2 s tone and 6 s silence → "No speech was recognised", no text.
  Note: no timeout if the 32 MB converter download itself stalls (P3, not reproduced).

## Test infrastructure (in repo)
- qa/harness/dev-mock.mjs — real app + real /api code, fake signed-in user, in-memory DB, mock AI (port 5190)
- qa/harness/browser-mock.js — Supabase REST/RPC/auth mock, knobs (save delay/failure), fake worker (canned lines)
- qa/e2e/lib.js + *.e2e.js — in-page tests: `(await import('/qa/e2e/<file>')).run()` on http://127.0.0.1:5190

## Blocked / not verifiable
(none yet)

## Resource use
- Real AI calls: 8 Haiku 5.5 calls, est. $0.0073 (budget ≤ 10 / $0.05); in-memory store only — qa/ai-real/run.mjs
- Model downloads: 0 (models already cached in the in-app browser origin 127.0.0.1:4312 only)


---
# Phase 2 (approved 2026-10-12): Preview + AI limits + account deletion + remaining defects
| # | Work | Status |
|---|---|---|
| 2.1 | Push qa/v1-release, Preview build identity, security headers, fixed defects on the real deployment | **done**: pushed d42952c, ccee2e2 (+ later); all 23 hashed assets present, HTML identical (CRLF only); headers on pages/JS/fonts/wasm/API; API 401 no-store signed out |
| 2.2 | Caching on the real Preview origin (real models, one download) | **done**: 607.6 MiB first visit, +0.2 MiB per reload (encoder in 3 parts); found /assets served max-age=0 → immutable rule added (2c0455c) |
| 2.3 | Isolated Postgres for SQL tests | **done**: PGlite with all production + billing migrations (qa/sql/pg.mjs); real PostgreSQL 18.4 via embedded-postgres for concurrency |
| 2.4 | AI limits | **done (stays OFF)**: proposed migration + server wiring (32b37c3); SQL 26 + concurrency 8 + server 19 + e2e 4; PostgREST PGRST202 fallback confirmed live |
| 2.5 | Account deletion | **done (not applied)**: proposed migration, SQL 20, Settings UI behind VITE_ACCOUNT_DELETION, e2e 5 (9c5ae7d, ec73ee4) |
| 2.6 | Defects | stash privacy fixed (5ebccb9, e2e 6); converter stall fixed (0805644, unit 9, real build stall test); PDF Unicode fixed (44214ec, unit 5 + e2e 1); D10 analysed, not changed (needs word-level eval set) |
| 2.7 | Browser compatibility, consolidated report | **done**: Safari < 16.4 CompressionStream crash fixed (e0097cb); support floor documented; REPORT.md phase 2 |

Phase 2 regression (final): unit 163 checks (8 files), SQL 26 + 20 + 8, e2e: home-save 8, a11y 4, security 4, auth 8, library 7,
transcript 8, insights 3, export-ui 4, ai-limits 4, account-deletion 5, pending-privacy 6, inputs on the build 4/4 applicable.
Real services touched: Preview (read-only browsing, one tone file through FFmpeg), Supabase prod (read-only SELECTs only),
PostgREST (one anonymous call to a non-existent RPC). AI spend in phase 2: $0. Model downloads: 0 new (FFmpeg 9.2 MB once).

# Launch-blocker resolution (2026-10-13) — report: docs/launch/LAUNCH-READINESS.md
| Blocker | Status |
|---|---|
| Auth email | diagnosed: confirmation required, no domain, built-in Supabase sender mails org members only; app resend + failure message (42744d7); Resend/DNS/SMTP steps in docs/launch/01 |
| AI cost controls | daily service breaker, real cost on failures (not charged to users), abandoned = estimate, Pro/trial/past_due, settlement maths, notices (47cba90); SQL 38, unit 39, e2e 5, concurrency 8, rollback 4 |
| Account deletion | flag-before-migration safe (d0b4d1d); data inventory + disclosures in docs/launch/03 |
| Legal/ops | drafts 04–08 (privacy, terms, AI disclosure, support/incident, hosting); Supabase Free = no backups + pausing; Preview shares the prod database |
Totals: unit 186, SQL 72, browser 66. Production untouched (read-only checks only).
