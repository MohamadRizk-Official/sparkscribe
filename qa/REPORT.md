# SparkScribe QA cycle — final report (2026-10-12)

Branch `qa/v1-release` (12 commits on top of `release/v1-speakers` 423b06b). Nothing pushed, merged or deployed.
Evidence labels: **tested** (executed) · **simulated** (mocked backend/worker) · **inspected** (code only) · **not verified**.

## A. Executive summary — Conditional

SparkScribe is **conditionally ready**: every P1 found was reproduced, fixed and re-tested, the speaker engine is unchanged
(blob 7ce03f9), and production data was untouched (fingerprints identical before/after). Release needs: your review of
this branch, a new Preview from it, the manual checks only a human/real browser can do, and two product decisions
(AI usage limit, account deletion) before inviting the public.

Highest-impact fixes:
- **Saved data corruption (P1):** pressing New during "Saving…" overwrote an earlier recording with the next transcript;
  two quick speaker edits could leave the older names in the database. Both fixed and verified.
- **Open redirect after sign-in (P1):** `next=%2F%09%2Fevil.com` sent users to another site. Fixed and verified.
- **Model download on every visit (P2, production today):** Chromium refuses cache entries > 256 MiB, so the 370 MB
  Whisper encoder re-downloaded on every page load (measured +368 MiB). Now stored in parts: reload = +0.2 MiB.

## B. Test coverage

| Area | Method | Result |
|---|---|---|
| Unit: metrics, AI service, tools/validators, exports, AI limits, request parsing | Node (`npm test`, 6 suites) | **143/143** |
| Home: process → results → auto-save; save race; edits during save; results timer; unsaved-work prompts; worker reuse | browser e2e, simulated backend + fake worker (`qa/e2e/home-save`) | 8/8 |
| Saved transcript: open (no AI), rename/move/someone new, persistence, failed save, out-of-order saves, Details | browser e2e (`transcript`) | 8/8 |
| Insights: Summary generate, failed Update, type change failure | browser e2e, mock AI (`insights`) | 3/3 |
| Export via dialog: TXT, MD, DOCX, PDF, SRT, VTT after a speaker correction | browser e2e (`export-ui`) | 3/3 |
| Library: list, search + highlight, empty search, rename, favorite (+ rollback), delete confirmation | browser e2e (`library`) | 7/7 |
| Accounts: signed-out redirect, validation, wrong/right password, sign-up, reset, crafted `next=` | browser e2e (`auth`) | 8/8 |
| Keyboard: drop box reachable/operable, Space not hijacked, named buttons | browser e2e (`a11y`) + real Tab key | 4/4 |
| Security helpers: safeNext, esc | browser e2e (`security`) | 4/4 |
| Model cache wrapper in real Chromium (353 MiB) | browser e2e (`model-cache`), no downloads | 6/6 |
| Model caching end to end | **real models**, release build, OS network counter | tested |
| Input edge cases: PDF, 0-byte, fake .mp3, 0.2 s, 6 s silence | **production build**, real decode + real models | 5/5 |
| Real recordings (earlier, release build): WhatsApp 0.0% WER; 23-min 24/27, 99.78% agreement with Node v1 | real models | tested |
| AI grounding: Action Plan statuses, Recap, Notes, Overview, Ask (on-topic, off-topic, decision vs suggestion) | **real Haiku 5.5**, scripted meeting, in-memory store | tested (8 calls, ~$0.007) |
| RLS: policies on 12 tables; random signed-in user / anon reads | production, read-only transactions | tested |
| Dependencies | `npm audit` | 0 vulnerabilities |
| Mobile 375 px + Light/Dark contrast | browser, harness | tested |
| Earlier on the Preview: deployed files byte-identical, no private files served, endpoints require sign-in | Preview | tested |

Limitations: harness tests use a mocked Supabase + fake worker (simulated); FFmpeg can't run under the Vite dev server
(those cases tested on a production build); real sign-up email, OAuth, password reset links, Safari/iOS and real phones
not verified; AI quality evidence is n=1 scripted meeting.

## C. Bug report (all reproduced before fixing unless marked inspected)

| ID | Sev | Defect | Root cause | Fix | Regression evidence |
|---|---|---|---|---|---|
| D1 | P1 | New during "Saving…" overwrote the earlier recording with the next transcript | late insert assigned its id after reset; next save saw an id and synced into it | save generation guard | home-save D1 (failed before: row text replaced, v1→2) |
| D12 | P1 | quick speaker edits saved out of order → DB older than screen | concurrent full-state PATCHes | serialized save queue, latest state, retry + leave warning | transcript D12 (DB "Ava" vs screen "Ava Final" before) |
| D4 | P1 | open redirect via tab/newline in `next=` | prefix check; browsers strip \t\n | URL-parser origin check, control chars refused | security + auth e2e, live redirect |
| D5 | P1 (public) | no per-user AI limit | — | **prepared, off**: `AI_HOURLY_LIMIT` | ai-limits-test |
| D6 | P2 | encoder re-downloaded every page load (production today) | Chromium 256 MiB Cache Storage entry cap | chunked cache (`src/engine/model-cache.js`) | model-cache e2e; real network +368 → +0.2 MiB |
| D7 | P2 | New reloaded all models | reset terminated the worker | keep worker unless stopping a run / after error | home-save D7; real Get ready ~0 s |
| D2 | P2 | renames during the first save never saved | sync skipped without an id | sync after the insert lands | home-save D2 |
| D3 | P2 | Cancel in the 900 ms window re-opened results | untracked timer | timer bound to its transcript | home-save D3 |
| D8 | P2 | unsaved transcript lost on New / leaving | no confirmation / beforeunload | confirm dialogs, leave warning, pending sync flushed | home-save D8 ×2 |
| D9 | P2 | file picker unreachable by keyboard | label around hidden input, no tab stop | focusable named button + focus ring | a11y + real Tab |
| D12b | P2 | failed type change hidden by success toast; unsaved type shown | toast overwrite, set-before-save | rollback + persistent error | insights D12b |
| D13 | P2 | failed summary update silent; after reload old summary hidden | server hid failed content, didn't restore version | keep previous content + version, show with error | insights D13, ai-limits-test |
| D14 | P2 | Space/arrows hijacked on focused buttons | global handler only exempted inputs | ignore focused controls/modifiers/dialogs | a11y D14 |
| D15 | P2 | no security headers | — | frame-ancestors/XFO, nosniff, Referrer, Permissions | **verify on next Preview** |
| D19 | P2 | duplicate paid generation after 120 s while tools run 300 s | takeover window < function limit | 310 s tools / 75 s insights | ai-limits-test |
| D21 | P2 | Recap/Notes listed a completed task as an action item | shared ACTION_RULE | rule: leave out tasks done/cancelled later | real Haiku re-run |
| D22 | P2 | Light theme speaker names 1.66:1 contrast | dark-theme palette used as text | light text = hue 50% to black (5.0–8.1:1) | measured |
| D11 | P2→P3 | users can write their own AI result rows; grading prompt unbounded | server writes as the user (by design) | grading bounded (51 MB → 3.4 KB) | ai-limits-test |
| D16 | P3 | blank line in a transcript line broke SRT/VTT cues | no cue sanitising | one-line cues, VTT escaping | export-test (old code fails) |
| D17/D18 | P3 | two unescaped template values; `/^d+$/` regex | — | escaped; `\d` | inspected |
| audit | P3 | raw provider error text; body limit bypass when pre-parsed | — | generic message; limits + 400 | http-test |

Not fixed (documented): **D10** short speaker turns dropped by transcription filters (0.3 s minimum, low-confidence
single words, "Thank you"/"you" filter, empty first pass never retried) — on the 23-min recording 10.2 s of speech
(0.7%) and 4 of 33 marked switches; line merging itself never hides another speaker. Needs a transcription change plus
model-based WER testing → follow-up. **D20** no account deletion → needs approval (auth/backend). Pending transcript
parked for sign-in can land in the next account on a shared computer (P3). No timeout if the 32 MB converter download
stalls (P3, not reproduced). PDF export replaces non-Latin-1 characters with "?" (P3; V1 is English-only).

## D. Changes made
Files: src/main.js, src/pages/transcript.js, src/insights/insights.js, src/insights/export.js, src/insights/tools.js,
src/lib/account.js, src/library/dialogs.js, src/pages/library.js, src/engine/model-cache.js (new), src/worker.js,
src/style.css, index.html, server/ai/service.js, server/ai/prompts.js, server/ai/anthropic.js, server/db.js,
server/http.js, vercel.json, package.json, .gitignore; tests: export-test, ai-limits-test, http-test, memory-store;
QA tooling in qa/ (harness, e2e suites, real-AI check, PROGRESS.md, this report). Speaker engine untouched.
Commits: a683ede daf2fc1 5f38741 39e61f1 826ef73 542272d 0d966b0 9664a6c 05655e0 743e741 61edf95 3699110 (+ this report).

## E. Performance
- Model download: Best/WebGPU ≈ 600 MB once (encoder 370 MB + decoder 194 MB + speaker 32.5 MB + runtime 5.5 MB).
  Before fix: encoder re-downloaded each page load (+368 MiB). After: reload + run +0.2 MiB; Get ready 8.4 → 4.2 s.
- New file: Get ready ~0 s (worker reused); WhatsApp 51 s note 13–15 s → 8.2 s end to end.
- 23-min recording (release build, WebGPU): speakers 11.4 s (verification ≈ 3 s), transcription 119 s (~12× real time);
  page JS heap peak 97 MB; app processes +2.2 GB peak, released after.
- No regressions measured; transcripts identical after the caching changes.

## F. Security and privacy
Verified: RLS on all 12 tables, owner-only policies; random signed-in user reads 0 rows/0 RPC results; anon has no
privileges; billing tables unreadable; API endpoints require a valid session (401); no service-role key anywhere; no
secrets in the bundle; private recordings/research not deployed; npm audit clean; open redirect closed; XSS escaping
checked; grading prompt bounded; request size limits; provider errors not forwarded; security headers added.
Audio stays on the device (unchanged). Unverified / needs decisions: per-user AI limit (prepared, off); full CSP;
server-only writes for AI results; account deletion; Supabase "secure password change" setting; email templates.

## G. Release blockers
True blockers before a **public** launch: (1) review + new Preview of `qa/v1-release` with the manual checks below;
(2) decide and enable an AI usage limit (D5); (3) a data-deletion path (D20) if you will accept public sign-ups.
Not blockers: D10 follow-up, full CSP, server-only AI writes, P3 items.

## H. Production-readiness checklist
1. Review the branch diff; approve pushing `qa/v1-release` for a Preview.
2. On the Preview: verify the security headers (D15) and run the acceptance checklist
   (https://claude.ai/artifact/Wva64VseJjR45y1WyyMreD) in real Chrome + a phone, including model caching after reload.
3. Decide `AI_HOURLY_LIMIT` (e.g. 60) and set it in Vercel; decide account deletion.
4. Approve merge into `main` → production deploy → post-deploy smoke (upload, save, Library, one AI tool).

## I. Next priorities
1. Short-turn word loss (D10): keep short turns' words (context-padded transcription or merge-then-split with word
   timestamps), measured with the existing WER + speaker suites.
2. Account deletion + data export.
3. Speaker features approved earlier: confirm/adjust speaker count, merge speakers, split/move single lines.
4. Full Content-Security-Policy; server-only writes for AI results.
5. Keep running `npm test` and the qa/e2e suites on every change.

---

# Phase 2 report — Preview, AI limits, account deletion, remaining defects (2026-10-12)

Branch `qa/v1-release`, pushed to GitHub (Preview `sparkscribe-git-qa-v1-release-moerizz.vercel.app`). Not merged, not in
production. Production database: read-only checks only; no table, function, column or migration added (verified at the end).
v1 speaker engine unchanged (`src/engine/diarize.js` blob 7ce03f9). AI spend this phase: $0.

## 1. What passed, and against what

| Area | Real services | Mocks / isolated | Result |
|---|---|---|---|
| Preview = this build | Preview (all 23 hashed assets, 5 pages) | — | identical (HTML differs only by local CRLF) |
| Security headers | Preview: pages, JS, fonts, wasm, API | — | all present; HSTS added by Vercel; API 401 `no-store` signed out |
| Model caching | Preview origin, real models | — | 607.6 MiB first visit → +0.2 MiB per reload; D7 worker reuse holds |
| Converter (FFmpeg) | Preview: 9.2 MB Brotli → 31 MB, 0.6 s, decode OK | stall server on the prod build: clear error at 31 s, retry works | pass |
| AI limits ledger | live PostgREST returns PGRST202 for the missing RPC → server runs unlimited | PGlite (26), real PostgreSQL 18.4 concurrency (8), server (19), browser (4) | pass; **stays off** |
| Account deletion | production FK/cascade map (read-only) | PGlite (20), browser (5) | pass; **not applied** |
| Shared-computer stash | — | browser (6) | fixed |
| PDF Unicode | — | Node (5) + browser export (1); PDF rendered and text-extracted | fixed |
| Safari < 16.4 | — | Node (3) | fixed |
| Full regression | — | unit 163, SQL 54, e2e 67 | all pass |

## 2. AI usage limits — design, tests, policy (nothing enabled)

Design (`supabase/proposed/20261012100000_ai_usage_limits.sql`): append-only `ai_usage` ledger (users read their own rows,
cannot insert/update/delete); `ai_reserve()` takes a per-user advisory lock, checks the hourly count and the period's spend
against `ai_plan_limits` for the user's plan (from `private.entitlement`), then records or refuses; `ai_settle()` (server
secret) records real tokens and cost; failed calls cost 0 but count toward the hour. Off unless `billing_settings.enforce_ai_limits`
is on or the request origin is in `enforce_origins` (a Preview-only trial is possible). Replaces the old row-count limiter,
which a user could reset by deleting results.

Verified: 50 simultaneous connections on real Postgres → exactly 20 allowed; the same function **without** the lock lets 50/50
through (so the test does detect races); budget race exact (7 of 12); per-user lock (same user waits, others don't); Plus
limits and immediate fall-back to Free on cancel; anon denied; cross-user isolation; settle needs the secret and can't touch
other users' rows; cascade on account deletion. Server: cached results never reserve; a refusal is HTTP 429 `rate_limited`
("Try again in about N minutes", with Try again) or `quota_exceeded` ("renews on <date>", UTC); no model call, no row.

Cost basis (production usage log, Haiku 5.5 at $0.10/M in, $0.50/M out): Ask $0.00044 · Overview $0.00065 · Insights ~$0.0011
· Notes $0.00125 · Quiz $0.00166 · Action plan ~$0.0022 · Study guide $0.0033. A typical action costs about $0.001.

| Plan | Hourly (burst guard) | Monthly model budget (cost guard) | ≈ actions/month | Worst-case AI cost vs price |
|---|---|---|---|---|
| Free | 20 | $0.15 | 100–340 | $0.15 per user (1,000 heavy free users ≤ $150/mo) |
| Plus $7.99 | 120 | $1.50 | 1,000–3,000 | ≤ 19% of price (plus Stripe ~$0.53) |
| Pro $14.99 | 240 | $3.50 | 2,000–8,000 | ≤ 23% of price (plus Stripe ~$0.73) |

Recommendation: (1) apply the migration with enforcement **off** and set `AI_DB_SECRET` (or reuse `BILLING_DB_SECRET`), so the
ledger records real costs for 2–4 weeks; (2) turn it on for the Preview origin only; (3) enable it for Free first (the monthly
budget is what bounds cost), then the hourly guard. Values change with an UPDATE, no deploy. Check the price table against
your Anthropic invoice; calls above 100k input tokens cost 5× (the settle step records that; estimates don't).
**Needs your approval:** the migration, the secret, and any `enforce_*` change.

## 3. Account deletion — design (implemented and tested in isolation; not applied)

`delete_my_account('DELETE')` (`supabase/proposed/20261012110000_account_deletion.sql`) deletes the `auth.users` row. Production
was checked read-only: every user table cascades (profiles, transcriptions, insights, artifacts, questions, folders, folder
items, usage, subscriptions, and ai_usage if applied), and so do Supabase's own sessions, identities, refresh tokens, MFA and
one-time tokens. Storage holds nothing (0 buckets). Guards enforced in the database: signed in; typed DELETE; latest sign-in
(JWT `amr`) under 10 minutes, with the dialog re-checking the password right before; refused while a paid plan would keep
charging. Kept: `billing_events` (accounting; pseudonymous id) and `private.account_deletions` (user id and Stripe customer id,
for a later server job that deletes the Stripe customer; not built, billing is paused). After deletion the browser forgets the
unsaved transcript, preferences and consent, and signs out; other devices' tokens can't write (FK) and refresh fails.
Recovery: none, with no soft delete. Supabase backups keep deleted data until they rotate out (daily backups, 7 days on Pro;
point-in-time recovery if enabled): say so in the privacy policy. Delete + re-sign-up resets free minutes (a hashed-email
tombstone would stop it; not built, a privacy trade-off for you).
UI: Settings → Account → "Delete account…" is hidden unless `VITE_ACCOUNT_DELETION=1` (set it in the release that applies
the migration). **Needs your approval:** the migration and the flag.

## 4. Remaining defects

| Defect | Severity | Reproducible | Fix | Regression tests |
|---|---|---|---|---|
| Unsaved transcript parked for sign-in is saved into the **next** person's account on a shared computer | **P2** (privacy) | always, within 24 h, any signed-in visit to / | **fixed**: kept 1 h, remembers the account, offered only on the `?save=pending` return as Save/Discard, cleared on sign-out and deletion; the card no longer renders half off-screen | pending-privacy.e2e 6 |
| Converter download stall leaves "Loading…" forever | P3 | with a stalled network (stall server) | **fixed**: 30 s no-bytes watchdog, 90 s start-up cap, progress, network-specific message, retry works | fetch-progress 9 + build stall test |
| PDF turns non-Latin-1 text into "?" | P3 | always (Łukasz, Greek, Cyrillic, Vietnamese) | **fixed**: lazy Noto Sans subset (OFL, 124 KB per weight, only when needed); CJK/RTL/emoji still "?", and the notice says how many | export-test 5, export-ui 1 |
| **D10** short turns dropped (0.3 s minimum, low-confidence single word, "Thank you"/"you" filter, empty pass not retried) | P2 (accuracy) | deterministic; 10.2 s (0.7%) and 4 of 33 switches on your reviewed 23-min recording | **not changed**: each filter trades lost words for invented ones; the only word-level references here are synthetic, AMI has speaker labels only, and your recording and held-out keys must not be tuned on | needs a public dev set with word timings (e.g. AMI word annotations), WER and hallucination rate before/after, plus the v1 regression |
| Safari 16.0–16.3: transcription crashed (no CompressionStream) | P2 for those users | static analysis | **fixed**: skip that one retry signal there; other browsers byte-identical | compat-test 3 |

Safest D10 order once you approve the experiment: (1) keep a high-confidence "Thank you." / "you" reply (gate the stock-phrase
filter on confidence, not only on length); (2) retry an empty first pass once with 0.5 s more context; (3) leave the 0.3 s
minimum. Each change ships only if WER improves and the hallucination count does not rise.

## 5. Browser compatibility

The build target (Vite 8 default) and the CSS used (`color-mix`, `:has`, `<dialog>`) set the floor at about **Chrome/Edge 111,
Safari 16.4, Firefox 121**. WebGPU is optional (falls back to WebAssembly on CPU, which is slower). Guards and fallbacks were
checked in code and in Chromium; Firefox and Safari/iOS were **not run** (see the manual list).

## 6. Real deployment vs local mocks — differences found

- Vercel serves the converter Brotli-compressed with no `content-length` (9.2 MB, not "32 MB"): copy and progress corrected.
- Hashed `/assets/*` were revalidated on every load (`max-age=0`): immutable rule added; verified on the refreshed Preview.
- PostgREST answers a missing RPC with `PGRST202` (404), confirmed live; the server's fallback relies on it.
- The local harness can't run FFmpeg or real AI; those paths ran on the production build, the Preview, or the earlier real
  Haiku run.

## 7. Still needs you

Approvals: AI-limits migration and secret (and any enforcement); account-deletion migration and flag; the D10 experiment;
merging `qa/v1-release` and deploying.
Manual tests on the Preview with a disposable account: save and reopen a real recording (text, speakers, timestamps intact);
the D8 leave-warning with real speech; sign-up/confirm and reset emails; the "sign in to save" round trip (Save/Discard card);
a PDF export with an accented speaker name; a framing check (an `<iframe>` of the Preview on another site is blocked);
Firefox, Safari (macOS ≥ 16.4) and iOS Safari: one short transcription each.
