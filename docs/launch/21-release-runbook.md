# Release runbook: four-tier SparkScribe to www.spark-scribe.com

The release candidate is branch `release/four-tier`, built on prelaunch/dev with the pricing, study-intelligence, Phase 3, Phase 4 and Phase 5-prep commits.
- Preview: https://sparkscribe-git-release-four-tier-moerizz.vercel.app (Stripe test mode).
- Production today: `main` 95bf377, the pre-billing app. It reads no billing table.

## 1. Owner actions (dashboards and credentials only you have)

| # | Where | What | Why |
|---|---|---|---|
| O1 | Vercel → Settings → Billing | Move the account from Hobby to Pro. This is a new recurring cost. | Hobby is for non-commercial use, and paid plans are commercial. |
| O2 | Supabase → Authentication → URL Configuration | Set the Site URL to `https://www.spark-scribe.com`. Add these redirect URLs: `https://www.spark-scribe.com/auth/callback`, `https://www.spark-scribe.com/**`, and `https://sparkscribe-git-release-four-tier-moerizz.vercel.app/**` (for the Preview). | Email links and Google sign-in must return to the real site. |
| O3 | Google Cloud Console → APIs & Services → Credentials | Create an OAuth client (Web). Authorized redirect URI: `https://strkrrdndoofpcenopxk.supabase.co/auth/v1/callback`. Consent screen: app name SparkScribe, support email contact.hrstudios@gmail.com, scopes `email`, `profile` and `openid` only. Publish the app. | Supabase reports Google sign-in is **off** today, so the button is hidden. |
| O4 | Supabase → Authentication → Providers → Google | Enable it and paste the client ID and secret from O3. Paste them only there, never in chat. | |
| O5 | Supabase → Authentication → Emails → SMTP | Custom SMTP through Resend on a subdomain, as in docs/launch/01-email-delivery.md §3. Sender `SparkScribe <no-reply@…>`, reply-to contact.hrstudios@gmail.com. | Supabase's built-in email only reaches team addresses. |
| O6 | Supabase → Authentication → Attack Protection | Turn on leaked-password protection. | Flagged by the security advisor. |
| O7 | Legal | Give the LLC's registration state (governing law), an optional postal address, and your approval of docs/launch/04 and 05 (the remaining [CONFIRM] items). | The production build refuses draft legal text. |
| O8 | Stripe (live) | Complete docs/launch/20-billing-four-tier.md, "What remains for live". | |

## 2. Release order (after O1, O2 and O7 and your go-ahead)

1. **Backup reference.** Run a Supabase point-in-time backup if the plan allows, or note the latest daily backup. Snapshot the counts: users, transcriptions, artifacts, usage, subscriptions.
2. **Legal.** Fill the facts, run `node scripts/build-legal.mjs --final`, and commit. The production build guard then passes.
3. **Production environment** (Vercel → Production). These already exist: `APP_URL`, `BILLING_DB_SECRET`, `AI_LIMITS_REQUIRED=1`, `VITE_ACCOUNT_DELETION=1`. Payment variables come only with step 8.
4. **Merge** `release/four-tier` into `main` (a PR with the test summary), then let Vercel build Production. Verify:
   - the deployed commit SHA;
   - the custom domain and SSL;
   - the root domain redirects to www;
   - `/`, `/pricing`, `/auth`, `/terms` and `/privacy` return 200;
   - private pages redirect to sign-in;
   - `/api/*` returns 401 when signed out.
5. **Catalogue cutover.** Run `supabase/proposed/20261016110000_four_tier_cutover.sql`. The new site doesn't depend on it; it only retires Plus and Pro for older builds.
6. **Turn on metering and enforcement** (one statement, at a known time):
   `update public.billing_settings set metering_starts_at = now(), enforce_quota = true, enforce_ai_limits = true;`
   Recordings saved before this are never counted. Free is 1,800 s a month from now.
7. **Smoke test on the real domain.** I can't create accounts, so this is a person with a fresh email account:
   - sign up, then confirm the email;
   - sign in, including with Google;
   - transcribe and save a short recording, then open it in My Library;
   - Summary, Ask and quiz;
   - the pricing page shows "Coming soon" until step 8;
   - Account shows Free, 30 minutes.
8. **Live payments** (separate approval, docs/launch/20). `STRIPE_PORTAL_CONFIGURATION_ID` is required: without it Stripe uses the account's default portal, which doesn't know the new prices, and plan changes fail. Set the live key and IDs, `STRIPE_AUTOMATIC_TAX` if registered, `BILLING_PAYMENTS_ENABLED=1`, `VITE_PAID_PLANS=1` and `BILLING_LIVE_APPROVED=1`. Then `update public.billing_settings set stripe_livemode = true;` and redeploy. Then one real purchase, which needs your authorization for that specific transaction.

## 3. Rollback

- **Site:** Vercel → Deployments → promote the previous production deployment, `main` 95bf377. It needs nothing from the new tables.
- **Enforcement:** `update public.billing_settings set enforce_quota = false, enforce_ai_limits = false;` takes effect instantly.
- **Catalogue:** `update public.billing_plans set active = (key in ('free', 'plus', 'pro'));`
- **Schema:** the files in `supabase/proposed/rollback/`, applied newest first. `20261016100000_four_tier.down.sql` deletes saved Thunder history, so export it first.
- **Payments:** unset `BILLING_PAYMENTS_ENABLED`. Existing subscribers can still reach the Customer Portal.

## 4. Monitoring after release

- **Vercel → Logs**, filtered on `[billing]` for webhook results, unknown prices (`"alert":true`) and duplicates, `[ai-usage]` for AI spend and failures, and `[across]` for history save failures. These lines carry ids and outcomes only, never transcripts, keys or emails.
- **Stripe → Developers → Webhooks:** check the failed-delivery rate.
- **Supabase → Logs (auth):** sign-in failures and email send errors.
- **Daily AI spend:** `select date_trunc('day', created_at) d, sum(cost_microusd)/1e6 usd from ai_usage group by 1 order by 1 desc limit 14;`. The service-wide breaker is $5/day.
