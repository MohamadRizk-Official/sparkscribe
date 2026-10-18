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

## 2–4. One command: live products, prices, coupon, portal, webhook, Vercel variables, readiness check
Create a **restricted live key** first (Developers → API keys → Create restricted key) with **Write** on Customers,
Checkout Sessions, Subscriptions, Customer portal, Refunds and **Read** on Prices, Products, Coupons, Invoices, Invoice
payments, Subscription schedules. Then, in the project folder, in your own terminal:
```
node scripts/stripe-live-setup.mjs
```
It asks for the live secret key and the restricted key at a hidden prompt (never stored or printed), stops with the
exact fix if the account isn't ready (activation, payouts, support email, Terms URL), creates everything, probes a live
Checkout per plan and interval without charging anyone, writes the Production variables to Vercel, and runs
`scripts/billing-check.mjs`. Rehearsed with `--dry-run` in test mode (passes). Payments stay off.

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
