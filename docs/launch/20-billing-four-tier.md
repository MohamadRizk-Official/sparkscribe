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
| **Real Stripe test mode** (`qa/sql/stripe-real.test.mjs`, 20 scenarios) | **32/32 checks, all 20 scenarios** (2026-10-16, after A1). Everything it created in Stripe was deleted. |

The real Stripe runner drives the 20 required scenarios against the real sandbox, using test clocks for renewals, with the real server code and an isolated database.
- **Scenarios:** $1 then $5.99 renewal; returning customer at $5.99; Bolt and Thunder; Flash to Bolt during the promo; Bolt to Thunder; Thunder to Bolt at period end; cancel at period end; failed renewal and recovery; declined first payment; double Checkout; duplicate, late and forged events; account deletion; unknown price; portal sessions; Stripe/database consistency.
- **Cleanup:** it deletes everything it creates.
- **Why it hasn't run:** it refuses to start while a webhook endpoint that predates scopes is enabled. The superseded prelaunch/dev Preview's test endpoint `we_1UQZYB2NvIja7bDRgDFtexYs` would log every QA event as refused in the production database's billing log. My attempt to disable that endpoint was refused by the permission system, so it needs your go-ahead.

**Not covered by any automated run:** paying on Stripe's hosted Checkout page. That needs a person: you, on the Preview, with test card 4242 4242 4242 4242.

## Real test-mode results (2026-10-16)

| # | Scenario | Result |
|---|---|---|
| 1 | Flash for a new account | The Checkout session shows $5.99 − $4.99 = **$1.00**. The first invoice is **$1.00**, paid. The account is on Flash (3 h) and the offer is used. |
| 2 | First renewal (test clock +32 days) | **$5.99**, paid, with no discount. Still Flash; the period moved to Stripe's new one, with the allowance full again. |
| 3 | Returning customer | Canceled, so Free. Checking out again costs **$5.99**: no second $1 month. |
| 4, 5 | Bolt and Thunder | $9.99 and $14.99 invoices. Thunder unlocks asking across recordings and combined guides. |
| 6 | Flash ($1) to Bolt on day 10 | Upgraded at once. The invoice is **$6.09**: a credit of −$0.68 for unused Flash time, at the discounted rate actually paid, plus $6.77 for the rest of the Bolt period. |
| 7 | Bolt to Thunder on day 15 | Upgraded at once; the prorated **$2.58** was paid. |
| 8 | Thunder to Bolt, scheduled for period end | Thunder is kept until renewal, and the Account page shows "Switches to Bolt on …". At renewal the account is on Bolt and pays $9.99. |
| 9 | Cancel at period end | The plan is kept and shown as ending; afterwards, Free with nothing charged. |
| 10, 11 | Failed renewal, then recovery | past_due: the plan is kept while Stripe retries, with a payment warning. After the card is replaced and the invoice paid, the account is active again. |
| 12 | Declined first payment | incomplete: no access, and the $1 offer is still available. |
| 13 | Two Checkouts | The second expires the first, so only one can be paid. |
| 14–16 | Duplicate, late and forged events | The duplicate is acknowledged and not re-applied; a late old event changes nothing; a forged signature gets 400. |
| 17 | Deleting a Thunder account | The subscription is canceled in Stripe, the customer deleted, and the account and its data are gone. |
| 18 | Unknown price | Free, plus an operator alert. |
| 19 | Customer Portal | A real portal session opens. A subscriber choosing another plan is sent to confirm the change in the portal; no second subscription is created. |
| 20 | Consistency | Stripe and the database agree for all 7 accounts, with at most one paying subscription each. |

**Defects found and fixed by these runs:**
- The offer was recorded as used on a Checkout that completed **unpaid** (possible with delayed payment methods). It's now recorded only when the Checkout is paid; the billing-server test covers this.
- Plan changes depend on `STRIPE_PORTAL_CONFIGURATION_ID`: the account's default portal doesn't know the new prices. The server now refuses a plan change without it (nothing charged), and the runbook lists it as required.

**Deployed Preview evidence:** Stripe delivered the QA run's real events to the Preview's webhook. Their signatures were verified, and they were ignored as another scope's objects (`webhook_ignored … other_scope` in the Vercel logs), so there were no database writes.

## Decisions (owner, 2026-10-16)
- **A1 approved:** the superseded prelaunch/dev test webhook `we_1UQZYB…` is disabled (test mode). The real test-mode scenarios are run below.
- **B1: downgrades at the end of the period** (portal `schedule_at_period_end`).
- **B3: 500 saved items per account;** at the cap, new saves are refused and nothing is deleted.
- **B4: the offer is once per account** (never had a paid plan).
- **B2 (upgrading during the $1 month):** measured above (scenario 6). Stripe credits only what was actually paid. **Recommendation: keep Stripe's standard proration.** The Terms text describes it, marked [CONFIRM] for your approval with the legal text.

## Decisions as first asked

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
