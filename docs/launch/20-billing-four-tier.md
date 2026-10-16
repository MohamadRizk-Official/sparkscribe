# Master Phase 4: Stripe for Free / Flash / Bolt / Thunder

Status 2026-10-16. Stripe is in **test mode only**. No live key exists anywhere, and no real card has been charged.

## What is built

### Prices and the offer

**Stripe test sandbox,** created by `scripts/stripe-setup.mjs`. The script is idempotent: it finds by lookup key and coupon id.

| Item | Test-mode ID |
|---|---|
| Flash $5.99/month | `price_1UR2jt2NvIja7bDRcYzfbtSQ` (lookup `sparkscribe_flash_monthly_599`) |
| Bolt $9.99/month | `price_1UR2k22NvIja7bDReJZ6V4vt` |
| Thunder $14.99/month | `price_1UR2k32NvIja7bDRzq2ykZea` |
| Flash first month | coupon `sparkscribe_flash_intro_499_1m`: $4.99 off, duration once, Flash product only |
| Customer Portal | `bpc_1UR2k32NvIja7bDReV3nQZUX` |
| Webhook (this branch's Preview) | `we_1UR2k42NvIja7bDRan7OB0bv` |

- **Products.** All carry the SaaS tax code, and prices are tax-exclusive. Prices are read from `billing_plans`, and the script refuses to run if Stripe and the database disagree.
- **Portal.** It lets customers update their card, see invoices, cancel at period end, and switch between Flash, Bolt and Thunder. Upgrades are prorated and invoiced at once. Downgrades are scheduled for the end of the period (decision B1 below).

### Eligibility and checkout (migration `20261017100000_flash_intro`, applied, additive)

- **Who gets $1.** An account is eligible if it has never had a paid plan and has never redeemed the offer, in the same Stripe mode.
  - **Paid history** is recorded when Stripe first reports a paid plan as active, trialing or past_due. A declined first payment never reaches that state, so the customer stays eligible.
  - **Redemption** is recorded when a Checkout that carried the coupon completes. Opening or abandoning Checkout uses nothing.
- **Checkout.** The server adds the coupon only when the database says the account is eligible. The browser can't request it; customer codes are disabled.
  - If the coupon isn't configured, Checkout is refused (`intro_unavailable`) rather than charging $5.99 after the page showed $1.
  - The pricing page and Account page show $1 only to eligible accounts (`introEligible` from `billing_status`). Signed-out visitors see "for new subscribers".
- **Two Checkouts at once.** Opening a new Checkout expires the earlier open ones. If two are paid at the same instant, the webhook keeps the first subscription and cancels and refunds the second. That second one is the only way a second discounted purchase can complete, and it gets refunded.
- **Portal plan changes** never apply the coupon.

### Webhooks and isolation

- **Scope tags.** Every Stripe object SparkScribe creates is tagged `sparkscribe_scope`. A webhook ignores objects from another scope. Previews, local QA and Production share one Stripe sandbox and one database, so without this, one deployment would treat another's test subscriptions as orphans and cancel them.
- **Unchanged and still covered by tests:** signature verification with a 5-minute tolerance, idempotent events, out-of-order safety (subscriptions are re-read from Stripe), duplicate cancel and refund, orphan cancel and refund, mode separation (`stripe_livemode`), and account deletion (cancel, then delete).
- **Unknown prices** grant nothing and log an operator alert, `[billing] {"event":"unknown_price","alert":true,…}`, with ids only.

## Tests

| Suite | Result |
|---|---|
| `qa/sql/billing-server.test.mjs` (real server code, real migrations, fake Stripe) | 58/58 |
| `qa/sql/flash-intro.test.mjs` | 17/17 |
| `qa/sql/billing.test.mjs`, `four-tier.test.mjs` | 43/43, 54/54 |
| Deployed Preview | webhook: unsigned 400, forged 400; billing API signed-out 401; pricing page shows "Get Flash for $1" / "Choose Bolt" / "Get Thunder" through sign-in |
| **Real Stripe test mode** (`qa/sql/stripe-real.test.mjs`, 20 scenarios) | **not run yet** (see A1) |

The real Stripe runner drives the 20 required scenarios against the real sandbox, using test clocks for renewals, with the real server code and an isolated database.
- **Scenarios:** $1 then $5.99 renewal; returning customer at $5.99; Bolt and Thunder; Flash to Bolt during the promo; Bolt to Thunder; Thunder to Bolt at period end; cancel at period end; failed renewal and recovery; declined first payment; double Checkout; duplicate, late and forged events; account deletion; unknown price; portal sessions; Stripe/database consistency.
- **Cleanup:** it deletes everything it creates.
- **Why it hasn't run:** it refuses to start while a webhook endpoint that predates scopes is enabled. The superseded prelaunch/dev Preview's test endpoint `we_1UQZYB2NvIja7bDRgDFtexYs` would log every QA event as refused in the production database's billing log. My attempt to disable that endpoint was refused by the permission system, so it needs your go-ahead.

**Not covered by any automated run:** paying on Stripe's hosted Checkout page. That needs a person: you, on the Preview, with test card 4242 4242 4242 4242.

## Decisions needed

- **A1. Permission:** disable the superseded test-mode webhook `we_1UQZYB…`, which points at the prelaunch/dev Preview, then run the 20 real test-mode scenarios. Test mode only, reversible.
- **B1. Downgrade timing:**
  - **Recommended: at the end of the period.** The customer keeps what they paid for and there's no partial credit; the portal schedules it. This is configured in test mode.
  - **Alternative: immediately,** with a prorated credit on the next invoice (the behaviour tested on 2026-10-14). Run `stripe-setup --downgrades immediately`.
- **B2. Upgrading during the $1 Flash month.** Stripe prorates by price. The real amount for "Flash at $1, then Bolt on day 10" will be measured by A1.
  - Recommendation: keep Stripe's standard proration, provided the measured amount is fair, i.e. the customer doesn't get credit for more than the $1 they paid.
  - If it isn't fair, the alternative is to start the new plan's period at the upgrade with no credit.
  - I'll show the measured invoice before asking you to choose.
- **B3.** Is a 500-item cap on saved Thunder answers and guides per account acceptable? At the cap, new saves are refused with a message; nothing is deleted.
- **B4.** Is "once per account" (never had a paid plan) enough for the offer?
  - A deleted account that signs up again with the same email would be eligible again. Blocking that would mean keeping a hash of the email after deletion.
  - Recommendation: no; the Terms already forbid using multiple accounts to get around plan limits.

## What remains for live (owner)

1. Activate the live Stripe account: HRstudios LLC details and bank account. Set the public business name to SparkScribe, the statement descriptor to `SPARKSCRIBE`, and the support email to contact.hrstudios@gmail.com.
2. Stripe Tax: add registrations only where HRstudios LLC must collect, then switch on `STRIPE_AUTOMATIC_TAX=1`.
3. Put the live secret key into Vercel → Production → `STRIPE_SECRET_KEY` (sensitive) yourself; never paste it in chat. Then I run `stripe-setup` in live mode, which creates the live prices, coupon, portal and webhook, and set the IDs in Production.
4. The final real-money authorization: `BILLING_LIVE_APPROVED=1`, `BILLING_PAYMENTS_ENABLED=1`, `VITE_PAID_PLANS=1`, `billing_settings.stripe_livemode = true`.
