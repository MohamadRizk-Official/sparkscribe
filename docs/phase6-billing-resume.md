# Stripe billing: runbook (prelaunch/dev)

Billing code lives on `prelaunch/dev` (merged from `phase-6-billing`). Nothing is live: no Stripe variables are set
anywhere, and the database billing settings are inert (`metering_starts_at = null`, `enforce_quota = false`,
`enforce_origins = {}`, `stripe_livemode = false`).

## What the code does
- Plans come from `billing_plans` (Free $0 / 60 min, Plus $7.99 / 20 h, Pro $14.99 / 50 h). The browser only ever
  sends a plan key; the server maps it to `STRIPE_<PLAN>_PRICE_ID`.
- Access is granted only by the signed Stripe webhook (`/api/stripe-webhook`), which re-reads the subscription from
  Stripe and writes it through secret-gated database functions. The Checkout return page only waits for that.
- Money needs three switches, checked on the server: a Stripe key, `BILLING_PAYMENTS_ENABLED=1`, and for a live key
  `BILLING_LIVE_APPROVED=1`.
- Protections: a second Checkout closes the first; two paid at once → the newer subscription is canceled and
  refunded; a payment or renewal for an account that no longer exists → canceled (and that payment refunded);
  duplicate, unsigned, stale, other-mode, unknown-customer, wrong-user and unknown-price events change nothing.
- Account deletion (`/api/billing` `delete_account`, needs the proposed `account_deletion` migration): recent sign-in
  checked first, then every Stripe subscription is canceled immediately, then the account is deleted, then the Stripe
  customer (saved card) is deleted. If Stripe can't be reached, nothing is deleted.

## Test mode (Preview `prelaunch/dev`)
Owner actions (Stripe dashboard, **Test mode** on):
1. Developers → API keys → reveal the **Secret key** (`sk_test_…`). Paste it into `.env.local` in the project folder
   as `STRIPE_SECRET_KEY=sk_test_…` yourself. Never in chat.
2. Settings → Business → Public details: business name **SparkScribe**. Settings → Branding: icon and colour.
3. Create two disposable SparkScribe accounts on the Preview (for example `you+stripetest1@…`, `you+stripetest2@…`).

Then (after approval):
1. `node scripts/stripe-setup.mjs --webhook-url https://sparkscribe-git-prelaunch-dev-moerizz.vercel.app/api/stripe-webhook --secret-out <scratch file>`
   creates or reuses the Plus/Pro products and prices, the Customer Portal configuration and the test webhook.
2. A new `BILLING_DB_SECRET` (random; its SHA-256 replaces `private.billing_secrets` `server`; the old value
   belonged to the retired phase-6-billing Preview).
3. Vercel **Preview, branch `prelaunch/dev` only**, all Sensitive: `STRIPE_SECRET_KEY` (test), `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_PLUS_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_PORTAL_CONFIGURATION_ID`, `BILLING_DB_SECRET`,
   `BILLING_PAYMENTS_ENABLED=1`, `VITE_PAID_PLANS=1`, `APP_URL=https://sparkscribe-git-prelaunch-dev-moerizz.vercel.app`.
   Never `BILLING_LIVE_APPROVED`. Redeploy the branch.
4. Optional, to test limits on the Preview only: `update billing_settings set metering_starts_at = now(),
   enforce_origins = '{https://sparkscribe-git-prelaunch-dev-moerizz.vercel.app}'`. (Metering is database-wide: from
   then on Production saves are counted too, but not limited while `enforce_quota` is false.)
5. Flows: Free → Plus in Checkout (card 4242 4242 4242 4242, any future date, any CVC, entered by the owner);
   `node scripts/stripe-test-flows.mjs --customer cus_… <step>` for renew, fail-renew, fix-card, upgrade,
   downgrade, cancel-end, resume, cancel-now, decline, and a second subscribe (duplicate handling).

## Live mode (Production), only after every test passes and with the owner's final approval
1. Stripe live: account activated (business, bank, identity); tax decision (Stripe Tax is not built in);
   statement descriptor; refund policy.
2. Final `/terms` and `/privacy` pages, then in live mode:
   `node scripts/stripe-setup.mjs --webhook-url https://<production host>/api/stripe-webhook --secret-out <file> --legal-base https://<production host>`.
3. Vercel **Production only**: live `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, price IDs, portal ID,
   `BILLING_DB_SECRET`, `APP_URL`, `BILLING_PAYMENTS_ENABLED=1`, `VITE_PAID_PLANS=1`, and last `BILLING_LIVE_APPROVED=1`.
   Preview keeps test keys only.
4. Database at launch: `update billing_settings set stripe_livemode = true, metering_starts_at = now(),
   enforce_quota = true, enforce_origins = '{}'`. From then on, test subscriptions on Previews no longer grant access
   (the database honours one Stripe mode at a time).
5. Rollback: unset `BILLING_PAYMENTS_ENABLED` (Checkout stops at once; the portal stays open so nobody is stuck),
   `update billing_settings set enforce_quota = false`; redeploy the previous Production deployment.
