# SparkScribe — launch-readiness report (2026-10-13)

> Superseded for current status by `PRELAUNCH-REPORT.md` (2026-10-13, branch `prelaunch/dev`).

**Baseline:** release candidate `qa/v1-release` (Preview `sparkscribe-git-qa-v1-release-moerizz.vercel.app`). Production
is still `main` @ 95bf377. Nothing has been merged, deployed, migrated or reconfigured in production. The v1 speaker engine
is unchanged (`src/engine/diarize.js` 7ce03f9).

## 1. Status of the four blockers

| Blocker | Status | What's left |
|---|---|---|
| **1. Auth email delivery** | **Diagnosed and prepared; needs your accounts.** Confirmation is required, no domain exists, and no SMTP credentials exist anywhere. The built-in Supabase sender only mails organization members, so public users can't confirm or reset. App fallback built: "Send the link again" and a plain send-failure message. | Buy a domain, set up Resend + DNS, configure Supabase SMTP, templates and redirect URLs (`01-email-delivery.md`); confirm the SMTP toggle |
| **2. AI cost controls** | **Ready to apply.** Per-user hourly and monthly limits per plan, a $5/day service-wide breaker, an always-on flood ceiling, fail-closed checks, settlement verified, failed and abandoned calls handled, an emergency switch, user-facing notices. | Your approval: migration, secret, env vars; Anthropic Console spend limit |
| **3. Account deletion** | **Ready to apply.** Full cascade, password re-check (refreshes don't count), paid-plan guard, accounting records kept, browser cleared, both enable orders safe, tested rollback. | Your approval: migration + flag; privacy text on backups |
| **4. Legal and operations** | **Drafts ready for review.** Privacy Policy, Terms, deletion and retention disclosure, AI disclosure, support, incident and recovery procedures, hosting review. | Lawyer review of the [LEGAL REVIEW] parts; your [CONFIRM] facts; then I add `/privacy` and `/terms` pages and links (about 1 hour) |

## 2. Completed autonomously (QA branch commits)

- **42744d7 — email fallback:** "Send the link again" after sign-up and on "email not confirmed"; a friendly message
  when the email service refuses. Browser tests: auth 10/10.
- **47cba90 — AI controls:**
  - a service-wide daily breaker;
  - failed calls record real cost but aren't charged to the user;
  - abandoned calls count at their estimate;
  - Pro, trial and past-due entitlements tested;
  - settlement maths verified (price table, long-prompt rate, settle-once, cached);
  - "paused" and "unavailable" shown as notices.
  - Tests: SQL 38, unit 39, browser 5/5, concurrency 8 (re-run), rollback 4.
- **d0b4d1d — deletion:** a browser test for flag-on-before-migration ("not switched on, nothing deleted"). Deletion
  suite 5/5.
- **Earlier this cycle (pushed):** fail-closed checks, server-named origin, the plan fallback, the flood ceiling, the
  `amr` sign-in fix, the kill switch, tested rollbacks.
- **Read-only production research:**
  - auth settings (sign-up on, confirmation required, email only);
  - account confirmation states;
  - empty in-database auth audit log;
  - database size 18.7 MB;
  - measured AI tokens per feature;
  - foreign-key map;
  - plan = Free;
  - no domains;
  - environment variable names.
- **Documents in `docs/launch/`:**
  - `01` email
  - `02` AI controls
  - `03` deletion and data inventory
  - `04` Privacy Policy draft
  - `05` Terms draft
  - `06` AI disclosure
  - `07` support and incidents
  - `08` hosting

## 3. Requires your action or approval

**Your accounts (exact steps in the docs):**
1. Buy a domain.
2. Set up Resend: domain, DNS records, API key.
3. Configure Supabase SMTP, rate limit, templates, Site URL and Redirect URLs.
4. Confirm the SMTP toggle was off.
5. Set an Anthropic Console spend limit (for example $50/month).
6. Decide on Supabase Pro ($25) and Vercel Pro ($20). Confirm your Vercel plan.
7. Choose a legal entity, contact addresses, minimum age and governing law. Get legal review.

**Approvals (I'll execute or guide, step by step):**
- the two migrations;
- `enforce_ai_limits = true`;
- the secret: option A (reuse Preview's value) or option B (new value plus a hash update);
- the env vars;
- merge and deploy;
- the `/privacy` and `/terms` pages once the text is final.

## 4. Initial AI limits and expected costs

| | Free | Plus | Pro | Service-wide |
|---|---|---|---|---|
| Per hour | 20 actions | 120 | 240 | ceiling 1,000 per user |
| Per month | $0.15 model cost (about 30 full sessions) | $1.50 | $3.50 | $5 per 24 h breaker |

Costs measured in production: Ask $0.00044 · Overview $0.00062 · Notes $0.00125 · Insights $0.0011 · Quiz $0.00166 ·
Study guide $0.00335. A typical session costs about $0.005.

Expected AI spend:
- 100 active users: about $3 a month.
- 1,000 active users: about $30 a month.
- Hard ceiling: about $150 a month (breaker).

Fixed hosting if you upgrade: about $46–48 a month. Free use is **enforced from the first request** of the release; it's
never left unlimited.

## 5. Database migrations and environment variables

**Migrations (in this order; both additive; rollbacks tested):**
1. `supabase/proposed/20261012100000_ai_usage_limits.sql`
2. `supabase/proposed/20261012110000_account_deletion.sql`

Then `update public.billing_settings set enforce_ai_limits = true;`

| Variable | Production | Preview |
|---|---|---|
| `BILLING_DB_SECRET` | **add** (option A or B, `02-ai-cost-controls.md`) | exists (update if option B) |
| `AI_LIMITS_REQUIRED` | **add `1`** (after the migration) | **add `1`** (after the migration) |
| `VITE_ACCOUNT_DELETION` | **add `1`** (after the migration) | **add `1`** |
| `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | exist | exist |
| `AI_LIMITS_DISABLED` | never (emergencies) | never |

Note: Preview and Production share one Supabase project.

## 6. Privacy Policy and Terms drafts

`docs/launch/04-privacy-policy-DRAFT.md` and `docs/launch/05-terms-of-service-DRAFT.md`, plus the disclosures in `03` and
`06`. They describe only what exists: on-device audio, text-only AI via Anthropic, no trackers, self-service deletion,
no backups on Free, no paid plans yet.

**Needs a lawyer:**
- GDPR legal bases and US transfers;
- CCPA wording;
- recording-consent laws;
- children's age;
- liability cap, governing law and venue;
- accounting retention;
- breach notification.

**Needs you:**
- entity, address and contact emails;
- effective date;
- minimum age;
- whether limits are published as numbers;
- Anthropic's current retention and no-training terms;
- the Supabase/Vercel plan (for the backup and log wording);
- the email provider;
- whether to self-host fonts (that would remove the Google Fonts disclosure).

## 7. Deployment plan

**Pre-flight (you):**
- email set up and verified with a non-team address (`01`, §5);
- legal text final, and the `/privacy` and `/terms` pages added and reviewed on the Preview;
- Anthropic spend limit set;
- plan decisions made.

| Step | Action | Check |
|---|---|---|
| 0 | `npx supabase db dump` (schema + data), stored safely; note the current production deployment in Vercel | files exist |
| 1 | Secret in Vercel (Production; plus Preview if option B) and, for option B, the hash UPDATE | — |
| 2 | Apply migration 1 (AI ledger) | functions exist; `enforce_ai_limits = false`; breaker = 5,000,000 |
| 3 | Apply migration 2 (deletion) | `delete_my_account` exists; advisors show only the expected entries |
| 4 | `update public.billing_settings set enforce_ai_limits = true;` | current production code is unaffected (it doesn't call the ledger) |
| 5 | Add `AI_LIMITS_REQUIRED=1` and `VITE_ACCOUNT_DELETION=1` (Production + Preview) | — |
| 6 | Merge `qa/v1-release` → `main` (fast-forward); Vercel deploys production | deployment Ready |
| 7 | Acceptance checklist (below) | all pass |
| 8 | Week 1: check `ai_usage` daily; adjust limits with UPDATEs | — |

Steps 2–4 are safe while today's code is live. From step 6, the limits apply to every AI request.

**Rollback:**

| Problem | Action | Time |
|---|---|---|
| App broken | Vercel Instant Rollback to the previous deployment (the database changes are additive) | about 1 min |
| Limits wrong | `UPDATE ai_plan_limits` / `enforce_ai_limits = false` / breaker `null` | instant |
| Ledger broken (AI "unavailable") | `AI_LIMITS_DISABLED=1` + redeploy; fix; or roll back migration 1 after removing `AI_LIMITS_REQUIRED` | minutes |
| Deletion problem | remove `VITE_ACCOUNT_DELETION` + redeploy, or `drop function public.delete_my_account(text)` | minutes |
| Email failing | switch the Supabase SMTP settings to the standby provider | minutes |
| Bad migration or data loss | restore from the step-0 dump (Free), or from backups (Pro) | hours |

## 8. Final acceptance checklist (production, after step 6)

1. Sign up with a **non-team** address → the confirmation email arrives and isn't in spam → the link signs you in.
2. Forgot password → the email arrives → the new password works.
3. Transcribe 1–2 minutes with two voices → save → reopen from My Library → names and timestamps intact.
4. Summary, one Ask, one Create tool → `select status, cost_microusd from ai_usage order by id desc limit 3;` shows
   `done` with costs above 0.
5. Settings → Delete account (password + DELETE) on that disposable account → signed out → signing in fails →
   (SQL) no rows left for it.
6. One short transcription each on iPhone Safari, Mac Safari and Firefox.
7. `/privacy` and `/terms` load and are linked from sign-up.

## 9. Go / No-Go

**Engineering: GO.** No open P0/P1 code defects. Every test suite passes on the candidate:
- unit 186;
- SQL 38 + 22 + 8 + 4;
- browser 66 (61 earlier + 5 new cases);
- real transcription verified.

**Public launch today: NO-GO**, for three reasons that aren't code:
1. Email delivery isn't set up. Public users can't confirm accounts.
2. The Privacy Policy and Terms aren't final or published.
3. The migrations and secret aren't applied, so AI would be unlimited and deletion unavailable.

**GO when:** the pre-flight items are done, steps 0–6 are executed with your approval, and checklist items 1–7 pass. That
is about one working day, mostly in your provider accounts. Strongly recommended first, though not strictly blocking:
Supabase Pro (backups, no pausing) and Vercel Pro (commercial use).
