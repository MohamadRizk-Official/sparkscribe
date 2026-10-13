# SparkScribe release candidate — assessment (2026-10-12)

**Candidate:** `qa/v1-release` @ `a8a16da` · Preview `sparkscribe-git-qa-v1-release-moerizz.vercel.app` (Ready, same commit)
**Production today:** `main` @ `95bf377` · Supabase `sparkscribe-prod` (Free plan, Postgres 17.11, 10 migrations)
Nothing merged, deployed to production, or applied to the production database. Production checks were read-only.

## 1. What would change in production

- **Code:** a fast-forward of `main` (`git log 95bf377..qa/v1-release`: code, tests and these QA reports). No `api/` route changes, no applied-migration changes.
  - The v1 speaker engine is the approved file (`src/engine/diarize.js` blob 7ce03f9).
  - The research archive under `accuracy/` is never bundled.
  - The release includes the earlier-approved `release/v1-speakers` product work (home v2 / light mode, activation pass,
    speaker rename and correction, Details, Action Plan statuses) plus all QA fixes.
- **User-visible fixes reaching production:**
  - D1 save race.
  - D12 out-of-order saves.
  - D4 open redirect.
  - D6 370 MB model re-download on every visit.
  - D7 worker reload.
  - Shared-computer transcript leak.
  - Converter stall.
  - PDF Unicode.
  - Safari < 16.4 crash.
  - Light-theme contrast.
  - Keyboard access.
  - Recaps listing finished tasks.
  - Plus all other phase 1/2 items.
- **Config:** `vercel.json` security headers, and year-long caching of content-hashed `/assets/*`.
- **New, dormant until switched on:**
  - The AI usage ledger: server code calls `ai_reserve` and runs unlimited while the function doesn't exist.
  - Settings → Delete account: hidden unless `VITE_ACCOUNT_DELETION=1`.
- **Pending migrations (in `supabase/proposed/`, not applied):**
  - `20261012100000_ai_usage_limits.sql`
  - `20261012110000_account_deletion.sql`
  - Both are additive, and both have tested rollbacks in `supabase/proposed/rollback/`.
- **Repo drift to note:** the two Phase 6 billing migrations are live in production but only exist on the unmerged
  `phase-6-billing` branch. The proposed migrations depend on them; the QA test databases load them from that branch.

## 2. AI usage ledger — final security review

| Question | Answer | Evidence |
|---|---|---|
| Can a broken check silently mean unlimited AI once limits are on? | **No (fixed today).** Only "function not installed" (PGRST202/42883) runs unmetered, and only while `AI_LIMITS_REQUIRED` is unset (pre-migration rollout). Network errors, timeouts, database errors, a thrown client and malformed replies all refuse with 503 `ai_unavailable`, without calling the model. | ai-limits-test: 13 new checks |
| Is the rollout fallback limited to the approved conditions? | Yes. It needs both: the function missing **and** `AI_LIMITS_REQUIRED` unset. After the migration, set `AI_LIMITS_REQUIRED=1`. The live Preview returns PGRST202 today (confirmed). | live PostgREST check |
| Can the database side fail open? | Fixed today: a plan without a limits row gets the Free limits, and missing limits or periods refuse when enforced. | SQL: 31 checks |
| Does "Preview-only" enforcement work for AI? | It didn't: the server sent no origin. Fixed: the server sends its own deployment host from Vercel env (`x-sparkscribe-origin`), so a browser can't influence it. | http-test 3, SQL 1 |
| Concurrency | 50 simultaneous requests → exactly 20 allowed on real Postgres; without the lock, 50 of 50 get through (the test detects races); per-user lock. | concurrency: 8 checks |
| Can users tamper with the ledger? | No inserts, updates or deletes; read-own only; settling needs the server secret; anonymous visitors denied. While enforcement is off, an always-on ceiling of 1,000 per hour stops direct-call flooding. | SQL |
| Is every model call covered? | Yes. Summary, insights, notes, Create tools, quiz grading and Ask (keywords plus answer as one action) all reserve after the cache check. Long transcripts are now estimated over every part. | code audit, test |
| Is real cost recorded? | Only with a server secret. **Production has none today** (only the Preview has `BILLING_DB_SECRET`). Without it, costs stay at their estimates. | `vercel env ls` |
| Emergency | `update billing_settings set enforce_ai_limits=false` (instant); `AI_LIMITS_DISABLED=1` (explicit, logged). | test |

## 3. Account deletion — readiness review

| Area | Status |
|---|---|
| Password verification | The dialog re-signs in with the password, then calls the RPC. The database requires a real sign-in within 10 minutes. **Fixed today:** a recent token refresh or sign-up entry in the token's `amr` no longer counts (Supabase lists `token_refresh` as an `amr` method). |
| Other-user isolation | The user id comes only from the JWT (`auth.uid()`), never from a parameter; another user's data is untouched (tested). Anonymous visitors are denied. |
| Data removed | Every user table cascades from the account (production FK map read-only): profiles, transcriptions, AI results, questions, folders, usage, subscriptions, ai_usage. Supabase's own sessions, identities, tokens and MFA cascade too. No orphans (tested). |
| Sessions | Supabase docs: an issued JWT stays valid until it expires (about 1 h). Writes then fail (FK) and refresh fails, so nothing can be created. |
| Paid subscriptions | Refused while a paid plan would keep charging, unless it's set to cancel at period end. The billing webhook treats an unknown customer as a final, logged refusal (no retry storm). |
| Retained financial records | `billing_events` (accounting; pseudonymous id). `private.account_deletions` keeps user id and Stripe customer id for a future Stripe clean-up job; not built, since billing isn't live. |
| Storage | 0 buckets. Note: Supabase refuses to delete a user who owns Storage objects. If Storage is ever added, delete their files first. |
| Browser data | The parked transcript, preferences (including custom vocabulary), AI consent and checklist state are cleared, and the session is signed out. Theme and the downloaded speech models stay; they're not personal. |
| Recovery | **None.** On the Free plan there are no restorable backups, so deletion is final. Say so in the privacy policy and in the dialog (it already says "can't be undone"). |
| Rollback | The tested down-migration drops the function and keeps the Stripe clean-up queue. The UI is hidden by flag. |

## 4. Verification on the release candidate

| What | Where | Result |
|---|---|---|
| Unit | Node | 180 checks |
| SQL | PGlite with all production migrations + real PostgreSQL 18.4 | ai-limits 31, deletion 22, rollback 4, concurrency 8 |
| Browser regression (mock services) | local harness, fresh state per suite | 61 / 61 across 11 suites |
| Real transcription, real models | identical production build (local) | 11 s clip in 7.5 s, word-for-word match; TXT/PDF/SRT exports correct; "Start over without saving?" prompt with real speech; sign-in-to-save parks the transcript correctly |
| Preview | real Vercel | build identical; routes; signed-out redirect to sign-in; Google button hidden; all AI endpoints 401 signed out; no eval/qa/accuracy/.env exposure; security headers; caching; converter 9.2 MB in 0.6 s |
| Production database | read-only | unchanged; advisor findings expected (secret-gated billing functions); leaked-password protection off |

**Changes since the last successful run:** server ledger hardening, the SQL ledger and deletion fixes, the kill switch and
the rollback scripts. Every suite above was re-run after them. Front-end assets are unchanged since phase 2 (same hashes).

## 5. P0 / P1 assessment

**Open P0/P1 code defects: none.** Production today still has D1, D4, D12 (P1) and D6; shipping this release fixes them.

Launch blockers that aren't code bugs:
1. **Sign-up emails (potential P0).** Sign-up requires email confirmation. Unless custom SMTP is configured, Supabase only
   emails the project's team members, at a low hourly cap, so public users could never confirm.
   *Verify, or configure SMTP (Resend, Postmark, SES…).*
2. **AI cost exposure (P1 for a public launch).** Today any signed-in user can generate without limit. Apply the ledger
   migration with the server secret and enable at least the Free monthly budget at launch.
3. **Account deletion before public launch** (your requirement): apply the migration and turn on the flag.
4. **Privacy policy / terms** (non-engineering): transcript text goes to Anthropic for AI features; deletion is final.
5. **Supabase Free plan (business risk).** No restorable backups or point-in-time recovery, and pausing after inactivity.
   Pro is $25/month and also enables leaked-password protection. Your decision.

## 6. Required production changes

| # | Change | Where | Who |
|---|---|---|---|
| C1 | Custom SMTP + auth email rate limit | Supabase → Auth | you |
| C2 | `BILLING_DB_SECRET` in **Production**, the same value as Preview (its hash is the stored `server` secret); or a new `AI_DB_SECRET` with its hash stored | Vercel env | you (never paste secrets in chat) |
| C3 | Migration `20261012100000_ai_usage_limits.sql` (enforcement off) | Supabase | with your approval |
| C4 | Migration `20261012110000_account_deletion.sql` | Supabase | with your approval |
| C5 | `VITE_ACCOUNT_DELETION=1` in Production | Vercel env | you / with approval |
| C6 | Merge `qa/v1-release` → `main` (fast-forward) → production deploy | GitHub / Vercel | with your approval |
| C7 | Later: `AI_LIMITS_REQUIRED=1`, then `enforce_ai_limits=true` | Vercel env / SQL | with your approval |
| — | Not needed: Stripe keys, billing changes, Google sign-in | | |

Requires Vercel's "automatically expose system environment variables" setting (on by default) for the server's origin header.

## 7. Recommended deployment order

0. **Pre-flight:** C1 done and tested with a non-team address. Take a manual database dump (`supabase db dump`): there are no
   backups on the Free plan. Note the current production deployment for instant rollback.
1. **C2** (env var; takes effect on the next deploy).
2. **C3, then C4** (additive; today's production code ignores them, so this is safe before the code). Verify the functions
   exist, `enforce_ai_limits = false`, and advisors show only the expected entries.
3. **C5**, then **C6**: merge and deploy.
4. **Smoke test, about 15 minutes:** sign in → transcribe → save → reopen → Summary → Ask → one Create tool. Then:
   - check `ai_usage` rows are `done` with a real `cost_microusd`, which proves the secret works;
   - export a PDF;
   - delete a disposable account and confirm its rows are gone.
5. **Observe 1–2 weeks** (enforcement off): look at real per-user costs. Then set **`AI_LIMITS_REQUIRED=1`** (redeploy).
6. **Enforce:** Preview first (`enforce_origins` = the Preview host), then
   `update public.billing_settings set enforce_ai_limits = true`. Free monthly budget first ($0.15); hourly guard after.

## 8. Rollback and failure recovery

| Failure | Action | Time |
|---|---|---|
| App regression after deploy | Vercel → Instant Rollback to the previous production deployment. The migrations are additive, so the old code works with them. | about 1 min |
| Limits refusing real users | `update public.billing_settings set enforce_ai_limits = false` | instant |
| Ledger broken (AI returns 503) | `AI_LIMITS_DISABLED=1` + redeploy (explicit, logged), then fix or roll back the migration (`rollback/…ai_usage_limits.down.sql`, after removing `AI_LIMITS_REQUIRED`) | minutes |
| Costs not being recorded | Check C2 (the secret and its stored hash); costs fall back to estimates meanwhile | — |
| Deletion problem | Remove `VITE_ACCOUNT_DELETION` + redeploy (hides it); `drop function public.delete_my_account(text)` stops it at once | minutes |
| Wrongly deleted account | Not recoverable on the Free plan; recoverable only from your manual dump | — |

## 9. Safe to postpone until after launch

- D10 short-turn word loss: needs a word-timed public dev set. No speculative transcription changes.
- Stripe customer clean-up job (billing isn't live).
- Moving AI result writes server-only (D11, P3).
- A full Content-Security-Policy.
- A tombstone against free-minute resets (privacy trade-off).
- Data export.
- Committing the billing migrations to `main` (repo hygiene).
- Firefox and Safari polish beyond the smoke tests.
- Long caching for fonts and the converter.
- Tuning plan limits from real ledger data.

## 10. Manual acceptance checklist (only what needs you)

Use the Preview and a disposable email address that is **not** a Supabase team member.
1. **Sign-up email:** create an account → the confirmation email arrives (proves SMTP, blocker 1) → the link signs you in.
2. **Password reset:** "Forgot password" → the email arrives → setting a new password works → sign in with it.
3. **Save and reopen:** record or upload 1–2 minutes with two voices → Save to Library → reopen from My Library. The text,
   speaker names and timestamps match; rename a speaker, reload, and it's kept.
4. **Sign in to save:** transcribe while signed out → Sign in → the "Save … to My Library?" card appears → Save opens it.
5. **AI once:** Summary, one Ask and one Create tool on that recording (a few cents of Haiku at most).
6. **Physical devices:** one short transcription each in Safari on a Mac (16.4+), Safari on an iPhone, and Firefox.
7. **After the production deploy:** delete the disposable account in Settings (password + DELETE); signing in again then fails.
