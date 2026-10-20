# Turning on real payments (owner steps)

**Blocker found 2026-10-17:** the Vercel team is on the **Hobby** plan, which is for non-commercial use only. Upgrade to
**Pro** (Vercel → Settings → Billing) before taking payments.

Everything in code, database and test mode is done and verified: four plans (Free; Flash $5.99/mo or $59/yr, $1 first
month on monthly only; Bolt $9.99/mo or $99/yr; Thunder $14.99/mo or $149/yr), yearly plans with monthly allowance
windows, checkout with the renewal terms beside the pay button, webhooks, entitlements, upgrades/downgrades, cancellation
at period end, Customer Portal, refunds of duplicates and orphans, account deletion stopping billing. Real Stripe
test mode: 41 end-to-end scenarios pass (qa/sql/stripe-real.test.mjs); `scripts/billing-check.mjs` passes on the test
configuration.

Paid checkout stays OFF in Production until step 7. Never paste a key or secret into a chat; type them only into
Stripe, Vercel, or your own terminal.

## 1. Stripe account (Dashboard, live mode)
- Finish account activation (business details, bank account) so charges and payouts are enabled.
- Settings → Public details: business name, **support email contact.hrstudios@gmail.com**, statement descriptor, and the
  **Terms of service URL https://www.spark-scribe.com/terms** and **Privacy policy URL https://www.spark-scribe.com/privacy**.
- Settings → Billing → Subscriptions and emails: turn on **receipts for successful payments**, **emails about failed
  payments**, and **renewal reminders for yearly subscriptions** (the Terms promise a reminder before each yearly
  renewal). Turn on **Customer Portal** links in emails if offered.
- Tax: decide with your accountant whether to collect sales tax now. If yes, add registrations under Tax and later set
  `STRIPE_AUTOMATIC_TAX=1`. If no, leave it off.

## 2–4. Two restricted keys, then one command
Dashboard → Developers → API keys → **Create restricted key** (live mode), twice. Every resource not listed: **None**.

| Key | Write | Read |
|---|---|---|
| **sparkscribe-setup** (temporary; delete after the command) | Products, Prices, Coupons, Customer portal, Webhook Endpoints, Checkout Sessions | — |
| **sparkscribe-production** (stays in Vercel) | Customers, Checkout Sessions, Subscriptions, Customer portal, Refunds | Invoices, Invoice payments, Subscription schedules |

(These come from every Stripe call the scripts and the server make: `scripts/stripe-permissions.mjs`.)

Then, in the project folder, in your own terminal:
```
node scripts/stripe-live-setup.mjs
```
It asks for both keys at a hidden prompt (never stored or printed) and:
1. checks each key's permissions without changing anything; a missing one is named, and the production key is refused
   if it has more than it needs or is the unrestricted secret key;
2. checks the account (activation, payouts, support email) where the key may read it;
3. creates or reuses the products, monthly and yearly prices, the Flash $1 coupon (monthly only), the Customer Portal
   (plans, cancel at period end, Terms/Privacy links) and the signed webhook for www.spark-scribe.com (an existing
   webhook is kept when Vercel already has its secret; nothing is duplicated);
4. opens a live Checkout for each plan and interval with the production key and expires it at once (nobody is
   charged; this also proves the account can take live payments and that the Terms URL is set);
5. writes the Production variables to Vercel (keys and webhook secret as Sensitive, through stdin);
6. runs `scripts/billing-check.mjs`.
Rehearsed with `--dry-run` in test mode (passes). Payments stay off.

## 5. Database (ask Claude to run it, or SQL editor)
`update public.billing_settings set stripe_livemode = true;` (live subscriptions grant plans only in live mode).
Metering/enforcement (`metering_starts_at`, `enforce_quota`, `enforce_ai_limits`) are switched on in the same step if
you want the plan limits enforced from launch (recommended: yes, so Free's 30 minutes and the paid allowances apply).

## 6. Disable the test webhook for Production
Nothing to do if no test endpoint points at www.spark-scribe.com (today none does).

## 7. Pilot: payments on for the owner only (Claude does this after step 2–4)
Vercel Production: `APP_URL=https://www.spark-scribe.com`, `BILLING_PAYMENTS_ENABLED=1`, `BILLING_LIVE_APPROVED=1`,
`BILLING_CHECKOUT_ALLOWLIST=<the owner's SparkScribe account email>`; database `stripe_livemode = true`; redeploy.
Everyone else still sees "Coming soon" and the server refuses their checkout (tested: billing-server.test.mjs).

## 8. One controlled live purchase (owner, with Claude checking)
Signed in to the allow-listed account on www.spark-scribe.com → Plan & billing → Upgrade to Flash ($1 first month) →
pay with your own card. Claude verifies: the webhook delivery, the subscription row (live, Flash, active), Plan &
billing showing Flash and 3 hours, the Customer Portal; then you cancel in Manage Billing (Flash stays until the
period ends) and refund the $1 in the Stripe Dashboard (Payments → the payment → Refund).

## 9. Public launch (Claude, after step 8 passes)
Remove `BILLING_CHECKOUT_ALLOWLIST`, set `VITE_PAID_PLANS=1` (Pricing buttons), turn on metering and enforcement in
`billing_settings` (`metering_starts_at = now()`, `enforce_quota`, `enforce_ai_limits`), redeploy, verify on the live
site. Rollback: set `BILLING_PAYMENTS_ENABLED=0` and redeploy (checkout stops at once; subscribers keep the portal), or
Vercel Instant Rollback to the previous deployment.

### Checking the keys first (no changes anywhere)
`node scripts/stripe-live-setup.mjs --check-keys` asks for both keys (FIRST the temporary setup key, SECOND the
Production key), shows only how many characters each prompt received, checks with a read-only request that Stripe
accepts each key (a 401 is reported as a rejected/expired key, never as missing permissions), checks each key fits its
role (and says so if the two were entered in the wrong order), then stops. After a key is rolled, only its new value
works.
