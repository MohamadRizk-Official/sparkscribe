# Turning on real payments (owner steps)

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

## 2. Create the live products, prices, coupon, portal and webhook
In your own terminal, in the project folder (PowerShell):
```
$env:STRIPE_SECRET_KEY = "<your sk_live_ key, typed here only>"
node scripts/stripe-setup.mjs --webhook-url https://www.spark-scribe.com/api/stripe-webhook --secret-out whsec-live.txt --legal-base https://www.spark-scribe.com
Remove-Item Env:STRIPE_SECRET_KEY
```
It prints only IDs (prices monthly + yearly, the Flash coupon, the portal configuration) and writes the webhook signing
secret to `whsec-live.txt`. Keep that file private and delete it after step 3.

Then create a **restricted key** for the server (Developers → API keys → Create restricted key) with Write on:
Customers, Checkout Sessions, Subscriptions, Customer portal, Refunds; Read on: Prices, Products, Coupons, Invoices,
Invoice payments, Subscription schedules, Events. Use it as the server's `STRIPE_SECRET_KEY` (the full secret key is
only needed for step 2).

## 3. Vercel → Project → Settings → Environment Variables (Production only)
| Name | Value |
|---|---|
| `STRIPE_SECRET_KEY` | the restricted live key (Sensitive) |
| `STRIPE_WEBHOOK_SECRET` | contents of `whsec-live.txt` (Sensitive) |
| `STRIPE_FLASH_PRICE_ID`, `STRIPE_BOLT_PRICE_ID`, `STRIPE_THUNDER_PRICE_ID` | monthly price IDs from step 2 |
| `STRIPE_FLASH_YEARLY_PRICE_ID`, `STRIPE_BOLT_YEARLY_PRICE_ID`, `STRIPE_THUNDER_YEARLY_PRICE_ID` | yearly price IDs |
| `STRIPE_FLASH_INTRO_COUPON` | the coupon ID |
| `STRIPE_PORTAL_CONFIGURATION_ID` | the portal ID |
| `STRIPE_REQUIRE_TOS` | `1` (Checkout asks the customer to accept the Terms; needs the Terms URL from step 1) |

Do **not** set `BILLING_PAYMENTS_ENABLED`, `VITE_PAID_PLANS` or `BILLING_LIVE_APPROVED` yet.

## 4. Check the configuration
With the same values in a private local file (for example `.env.live`, never committed):
`node scripts/billing-check.mjs --env .env.live --webhook-url https://www.spark-scribe.com/api/stripe-webhook`
Every line must be ✓.

## 5. Database (ask Claude to run it, or SQL editor)
`update public.billing_settings set stripe_livemode = true;` (live subscriptions grant plans only in live mode).
Metering/enforcement (`metering_starts_at`, `enforce_quota`, `enforce_ai_limits`) are switched on in the same step if
you want the plan limits enforced from launch (recommended: yes, so Free's 30 minutes and the paid allowances apply).

## 6. Disable the test webhook for Production
Nothing to do if no test endpoint points at www.spark-scribe.com (today none does).

## 7. Switch payments on (your explicit final approval)
In Vercel Production set `BILLING_PAYMENTS_ENABLED=1`, `VITE_PAID_PLANS=1`, `BILLING_LIVE_APPROVED=1`, then
redeploy Production (Deployments → … → Redeploy).

## 8. One controlled live purchase
With your own card: buy Flash monthly on www.spark-scribe.com/pricing ($1.00). Check: Checkout shows "$1 today for your
first month, then $5.99 every month until you cancel", the receipt email arrives, Plan & billing shows Flash, then cancel
in Manage Billing (stays Flash until the period ends) and refund the $1 in the Stripe Dashboard. If anything is off, set
`BILLING_PAYMENTS_ENABLED` back to `0` and redeploy: checkout stops at once; existing subscribers keep the portal.
