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
