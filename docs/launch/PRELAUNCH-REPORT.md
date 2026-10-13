# SparkScribe — pre-launch handoff (2026-10-13)

> **Update (same day):**
> - Anonymous-use analysis: `10-free-plan-and-anonymous-use.md`.
> - Preview exposure and protection steps: `11-preview-exposure.md`.
> - Domain-agnostic email checker: `scripts/check-email-dns.mjs`.
> - Production builds now refuse draft legal pages.
> - Billing copy no longer mentions payments while they're off.

**Branch:** `prelaunch/dev` (this report's commit) — built on the verified release candidate `qa/v1-release` plus the
paused Phase 6 billing work. **Preview:** https://sparkscribe-git-prelaunch-dev-moerizz.vercel.app
**Production:** untouched. `main` = 95bf377; no production data, migrations, environment variables, DNS or auth settings
changed. The v1 speaker engine is unchanged (7ce03f9). No Stripe account, no payments, no purchases.

Legend:
- **Ready now** — done and tested.
- **After approval** — prepared, needs your yes.
- **Waiting for LLC/Stripe**
- **Postpone** — safe after launch.

## 1. What was completed
- **Billing merged and made safe (payments off).**
  - Pricing, Plan & usage, usage meter, quota messages and the Stripe server (Checkout, Portal, webhooks) are now on
    the branch.
  - Charging needs three deliberate server settings: a Stripe key, `BILLING_PAYMENTS_ENABLED=1`, and for a live key
    `BILLING_LIVE_APPROVED=1`. Otherwise Checkout refuses before any Stripe call.
  - Pricing shows "Coming soon" unless `VITE_PAID_PLANS=1` and the server agrees.
- **Product behaviour kept:** transcription on the device still works without an account. The billing branch had
  forced sign-in; that's now a switch (`VITE_REQUIRE_ACCOUNT`) for you to decide.
- **Billing tests (none existed):** 42 database checks and 29 server/webhook checks, run against an isolated Postgres, a
  fake Stripe API and real Stripe signature verification.
- **Email:** found your domain (`sparkscribe.ai`, **[CONFIRM]**) and a problem with its company mail. Exact
  Resend + GoDaddy + Supabase setup, branded templates, and in-app resend and failure messages.
- **Draft `/privacy` and `/terms` pages:** clearly bannered as drafts, generated from the reviewed text, with a refunds
  and cancellation section and links in footers, sign-up and Settings.
- **Quality:**
  - accessibility scan fixed;
  - phone layout fixed;
  - new suites: billing UI, legal, appearance, accessibility, layout;
  - `npm run test:sql`.

## 2. Bugs fixed (reproduced first, regression-tested)
| # | Bug | Severity | Fix |
|---|---|---|---|
| 1 | Billing branch required sign-in to transcribe (production doesn't) | P1 product regression | switch, default off |
| 2 | Pricing showed working "Upgrade" buttons while payments can't work | P2 | "Coming soon"; server refuses anyway |
| 3 | No explicit server switch for taking payments (a key alone would enable it) | P1 safety | three-step switch; portal stays open for existing subscribers |
| 4 | Merge left a conflict marker → production build failed | P0 (caught before commit) | fixed |
| 5 | Plan reset date shown in local time ("October 31" for 1 Nov UTC) | P3 | UTC |
| 6 | Pricing / Plan & usage pages used an old header (logo missing) | P3 | shared header |
| 7 | "Account" page vs Settings → Account confusion | P3 | renamed "Plan & usage" |
| 8 | Light theme: tertiary text 3.8:1 and 4.4:1 contrast (WCAG AA fail) | P2 accessibility | 5.3:1 |
| 9 | My Library wider than the screen on 320 px phones | P2 | layout fixed |
| 10 | QA harness could reach production auth via /api/billing (one rejected token check happened) | P2 test safety | blocked in harness |
| — | **Not ours:** `sparkscribe.ai` has DMARC `p=reject` but **no SPF and no Microsoft 365 DKIM**, so company mail is likely rejected | P1 business | fix steps in `01-email-delivery.md` |

## 3. Features finished
**Ready now (on Preview):**
- upload, conversion and on-device transcription (real models, word error rate 0% on the regression clip);
- speaker naming and corrections;
- save and reopen, library and search;
- Summary, Notes, Ask, Insights;
- study guide, quiz, flashcards, action plans;
- exports, including Unicode PDF;
- authentication with resend;
- Settings: appearance, mascot, privacy;
- shared-computer privacy;
- AI usage notices;
- pricing and Plan & usage (display only);
- draft legal pages.

**After approval:**
- AI usage limits (migration);
- account deletion (migration + `VITE_ACCOUNT_DELETION`).

**Waiting for LLC/Stripe:** paid checkout, Customer Portal, webhooks in test mode, then live.

## 4. Unfinished
- **D10 short-turn word loss — Postpone.** It needs an independent word-timed evaluation set and about 2 hours of
  model runs. No speculative change was made.
- **Real-service checks I can't do without your accounts or Docker:** sign-up and reset emails; session invalidation
  after deletion against the real Auth server; Stripe test mode.
- **Legal texts:** lawyer review plus your confirmations.

## 5. Exact test results
**Mocks / isolated:**
- **Unit: 186 checks.** Metrics 12, service 47, tools 34, export 31, AI limits 39, http 11, fetch 9, compat 3.
- **Database, 143 checks:**
  - AI limits 38, deletion 22, rollback 4, billing 42, billing server 29 — all on PGlite with every production
    migration;
  - concurrency 8, on a real PostgreSQL 18.4.
- **Browser, 80/80 in the harness (mocked Supabase, fake worker, mock AI):**
  - home-save 8, accessibility 4, security 4, auth 10, legal 2, library 7, appearance 5;
  - billing 8, privacy 6, deletion 6;
  - transcript 8, insights 3, AI limits 5, export 4.
- **Accessibility scan:** 0 serious or critical issues across 8 pages and 5 tabs, light and dark.
- **Layout:** 0 overflow on 9 pages at 320 and 375 px.

**Real services:**
- **Real models on the production build:** 11-second clip, word error rate 0% (29/29 words), 7 s, signed out (no gate).
- **Real Vercel Preview + production Supabase (reads only):**
  - build identical (25/25 assets);
  - pricing loads the real plans and shows "Coming soon" with no upgrade buttons;
  - legal pages served with the draft banner;
  - security headers present;
  - `/api/billing` 401 signed out; `/api/stripe-webhook` 503 (not configured).

**Failed:** none.

## 6. Git
`prelaunch/dev` @ this report's commit (pushed). Previous checkpoints: 0389585, 98f9bca, 721dbee, 806ed68, 81a14e8.

## 7. Preview you can open
https://sparkscribe-git-prelaunch-dev-moerizz.vercel.app

**It is public** (Deployment Protection off) and **uses the production database**.
- Test only with throwaway accounts.
- Anyone with the link could create unconfirmed accounts. They can't sign in, because confirmation emails don't reach
  them yet.
- Turn on protection: Vercel → Project → Settings → Deployment Protection → Vercel Authentication → Standard
  Protection.

## 8. Security and privacy status
- Audio never leaves the device.
- Database access rules are on for all tables; every billing write is gated by a server secret.
- Webhook signatures are verified, with replay protection and idempotency.
- Payments are blocked server-side.
- AI limits fail closed; secrets never reach the browser.
- No analytics or trackers.
- Third parties the browser contacts: Google Fonts, Hugging Face, jsDelivr (all disclosed).
- Open items: Preview protection (above); leaked-password protection (Supabase Pro); CAPTCHA on sign-up (post-launch).

## 9. Account deletion readiness — After approval
- Identity: password plus a real recent sign-in (token refreshes don't count), and typing DELETE.
- Ownership and isolation: the user comes only from the token.
- Everything is deleted by cascade, including AI content and usage. Storage is empty.
- Billing records are kept: `billing_events` and the Stripe clean-up queue.
- Active paid plans block deletion until they're cancelled.
- Clear warnings and error paths are tested.
- Flag and migration are safe in either order.
- Rollback is tested.
- Free plan: no backups, so deletion is final.
- Still needs: approval of the migration and flag, plus the post-deploy check (a deleted user is refused by the real
  Auth server).

## 10. AI cost-control readiness — After approval
- **Limits:**
  - Free: 20 actions an hour, $0.15 a month;
  - Plus: 120 an hour, $1.50;
  - Pro: 240 an hour, $3.50;
  - a $5-per-24-hours service-wide breaker;
  - a 1,000-per-hour ceiling per user.
- **Behaviour:**
  - atomic under concurrency;
  - failed calls are recorded but not charged to the user; abandoned calls count at their estimate;
  - cached results are free;
  - any database failure refuses the request (503);
  - emergency switches: `enforce_ai_limits = false` (instant), the breaker set to null, or `AI_LIMITS_DISABLED=1` (logged);
  - every limit shows a plain notice.
- **Cost:** about $0.005 per full session; about $3 a month per 100 active users; a hard ceiling of about $150 a month.

## 11. Stripe integration readiness — Waiting for LLC/Stripe
- **Built and tested with fakes:**
  - Checkout (new subscribers), plan change through the Portal (prorated), cancel at period end;
  - failed payments (access kept while Stripe retries, then Free);
  - renewals reset usage;
  - unknown, foreign and stale events refused;
  - idempotent event log;
  - entitlements decided only by the database (Free 60 min, Plus 20 h, Pro 50 h);
  - transcription minutes metered at save, with a server-side quota (off).
- **When the LLC exists:**
  1. Stripe account in **test mode**.
  2. Run `scripts/stripe-setup.mjs` (creates products, portal and webhook).
  3. Set test env vars on a **branch-scoped Preview** only.
  4. Test the checkout flows with test cards.
  5. Then live keys in Production, `BILLING_PAYMENTS_ENABLED=1`, `BILLING_LIVE_APPROVED=1`, `VITE_PAID_PLANS=1`.
  6. Then the database: `stripe_livemode`, `metering_starts_at`, `enforce_quota`.

  Details: `docs/phase6-billing-resume.md`.

## 12. Domain and email — your accounts (`01-email-delivery.md`)
1. **Microsoft 365 fix:** root SPF `v=spf1 include:spf.protection.outlook.com -all` + the two DKIM CNAMEs from the
   Defender portal.
2. **Resend:** domain `auth.sparkscribe.ai`; in GoDaddy add MX `send.auth`, TXT `send.auth` (SPF) and TXT
   `resend._domainkey.auth` (DKIM). Keep the existing DMARC.
3. **Supabase:** custom SMTP (`smtp.resend.com:465`, user `resend`, the API key, sender `no-reply@auth.sparkscribe.ai`),
   rate limit, the three templates, Site URL and Redirect URLs.
4. Verify with a non-team Gmail address (SPF, DKIM and DMARC all PASS).

The website domain stays unpointed.

## 13. Production migrations and environment variables
**Migrations (After approval; additive; tested rollbacks):**
- `supabase/proposed/20261012100000_ai_usage_limits.sql`
- `supabase/proposed/20261012110000_account_deletion.sql`

Then `update public.billing_settings set enforce_ai_limits = true;`

The billing schema is already live in production. Note: the repo's migration filenames don't match production's
recorded versions. Apply through the dashboard/MCP as before; don't run `supabase db push` without repairing the history.

| Variable | When | Value |
|---|---|---|
| `BILLING_DB_SECRET` | launch | same as Preview, or new + hash update (`02-ai-cost-controls.md`) |
| `AI_LIMITS_REQUIRED` | launch, after the migration | `1` |
| `VITE_ACCOUNT_DELETION` | launch, after the migration | `1` |
| `APP_URL` | when the app moves to its own domain | `https://sparkscribe.ai` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_*_PRICE_ID`, `STRIPE_PORTAL_CONFIGURATION_ID` | LLC/Stripe | test on Preview, then live |
| `BILLING_PAYMENTS_ENABLED`, `BILLING_LIVE_APPROVED`, `VITE_PAID_PLANS` | paid launch only | `1` |
| `VITE_REQUIRE_ACCOUNT` | only if you decide accounts are required to transcribe | `1` |
| `AI_LIMITS_DISABLED` | emergencies only | never by default |

## 14. Remaining business decisions
1. Confirm the domain is `sparkscribe.ai`; choose support and privacy addresses.
2. Free plan: 60 minutes a month (current table) or more; whether to meter or enforce transcription minutes at launch.
   On-device transcription costs you nothing; I recommend metering without enforcing for Free at launch.
3. Require an account to transcribe? (Current product: no.)
4. Show `/pricing` at launch ("Coming soon") or hide it until Stripe is live.
5. Refund policy, minimum age, governing law, entity details (after the LLC).
6. Supabase Pro ($25/month: backups, no pausing) and Vercel Pro ($20/month: commercial use).
7. Approve the D10 evaluation, or leave it until after launch.

## 15. Recommended deployment order
**Free launch (no payments):**
1. Email setup (12) and the Microsoft 365 fix.
2. Deployment Protection on.
3. Legal texts finalized; rebuild the pages with `node scripts/build-legal.mjs`, removing the draft banner only when
   final.
4. Plan upgrades decided.
5. `npx supabase db dump` (schema + data).
6. `BILLING_DB_SECRET` in Production.
7. The AI-limits migration, then the deletion migration, then `enforce_ai_limits = true`.
8. `AI_LIMITS_REQUIRED=1` and `VITE_ACCOUNT_DELETION=1`.
9. Merge `prelaunch/dev` → `main` (fast-forward after review).
10. Smoke test (checklist below).
11. Watch `ai_usage` daily for the first week.

**Paid launch (after LLC):** Stripe test mode on a branch Preview → full billing checklist → live keys and switches →
database flags → smoke test.

**Rollback:**
- Vercel Instant Rollback (the database changes are additive).
- `enforce_ai_limits = false` or the breaker set to null.
- Remove `VITE_ACCOUNT_DELETION`.
- Remove `BILLING_PAYMENTS_ENABLED` (Checkout stops at once on redeploy).
- `enforce_quota = false`.
- Restore from the step-5 dump (Free plan has no backups).

## 16. Your short manual checklist
1. GoDaddy / Microsoft 365: add SPF and DKIM. Test mail from Outlook to Gmail: all PASS.
2. Resend + Supabase SMTP and templates: sign up on the Preview with a non-team Gmail; the email arrives; "Send the link
   again" works; the password reset works.
3. Vercel: turn on Deployment Protection for Previews.
4. On the Preview, with a throwaway account:
   - transcribe 1–2 minutes with two voices, save, reopen, rename a speaker;
   - one Summary, one Ask, one Create tool;
   - export a PDF;
   - Pricing shows "Coming soon"; Plan & usage shows Free.
5. Phones and browsers: iPhone Safari, Android Chrome, Mac Safari, Firefox — one short transcription each, light and dark.
6. Legal: send `04`/`05` (or the `/privacy` and `/terms` pages) to a lawyer; answer the To-confirm notes.
7. Approve: the migrations, the env vars and the merge (section 15).
