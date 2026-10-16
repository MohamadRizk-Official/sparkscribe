# Four-tier pricing: Free · Flash · Bolt · Thunder (Phase 1 notes, 2026-10-15)

Phase 1 (this branch, `pricing/four-tier`) is the pricing page design only, shown on a Vercel Preview with
`VITE_PRICING_PREVIEW=1`. No database, Stripe, entitlement or production change was made.

| Plan | Price | Transcription / month |
|---|---|---|
| Free | $0 | 30 minutes |
| Flash | $1 first month, then $5.99/month | 3 hours |
| Bolt | $9.99/month | 9 hours (3× Flash) |
| Thunder | $14.99/month | 20 hours |

## How the preview is isolated
- `src/lib/pricing-catalog.js` holds the proposed lineup as frozen presentation data. The server never imports it
  (checked by `tests/pricing-catalog-test.mjs`).
- The page uses it only when built with `VITE_PRICING_PREVIEW=1`. That variable is set in Vercel **for the Preview
  environment of the `pricing/four-tier` branch only**. A production build with the flag fails
  (`pricing-preview-guard` in `vite.config.js`, tested).
- Preview buttons never call `/api/billing`. They open an explanation that checkout isn't connected. The server
  would refuse these plan keys anyway ("Choose Plus or Pro": they aren't in `billing_plans`).
- Without the flag, the same page renders the database lineup with the new design and the existing checkout rules.

## Features: what exists today vs. proposed differentiators
**Every plan has all of these today** (no per-plan feature gates exist; plans differ only in transcription time
and AI fair-use limits): on-device transcription with speakers and timestamps; Summary; Notes; Ask (one recording);
Study Guide (with key definitions and possible exam points); Flashcards; Practice Quiz with **Level
(Standard/Challenge)**, **Focus (incl. "Exam focused")**, and **review/retake missed questions**; Meeting Recap;
Action Plan; Follow-up Email and Reply drafts; Interview Q&A; Episode Notes; library search across recordings; exports
(PDF, Word, Markdown, TXT, subtitles).

Important: three of the proposed **Bolt** extras (choosing quiz difficulty, topic-focused quizzes, practicing incorrect
answers) **already exist for everyone**. Making them Bolt-only would remove features from Free users. Recommendation:
keep them on every plan, and differentiate with features that don't exist yet.

**Not built yet (candidates for future approval):**
- Bolt: weak-topic review across quizzes and recordings (a running record of what you keep missing); exam-prep
  workflow (a study plan across a course's recordings).
- Thunder: Ask across selected recordings; a course-wide study guide built from several recordings; consolidated
  review of a collection; batch workflows (several files at once).

The preview advertises none of these.

## Phase 2: plans, database, entitlements (after design approval)
1. **Migration (reviewed, with rollback):**
   - Insert `flash` (599, 10800 s), `bolt` (999, 32400 s) and `thunder` (1499, 72000 s).
   - Set `free` to 1800 s, and set `sort_order`.
   - Mark `plus`/`pro` `active = false` but keep them: `subscriptions.plan` has a foreign key to `billing_plans`.
   - Add `ai_plan_limits` rows for the new keys; it has a foreign key, and without a row the plan has no AI limits.
     Proposed: Flash 60 actions/hour, $0.75/month; Bolt 120/h, $1.50; Thunder 240/h, $3.00 (decision).
   - Add an `intro_price_cents` column, or keep the intro only in Stripe (recommended: the server decides, and the
     database stores what was granted).
2. **Free allowance 60 → 30 minutes:** decide when it starts for the 3 existing Free accounts (recommended: the
   next calendar month, and announce it).
3. **Existing subscriptions:** live payments never launched, so there are **no paying Plus/Pro customers**; only Stripe
   test-mode subscriptions exist. Recommendation: retire Plus/Pro (inactive). Cancel the test subscriptions, or let
   them run out in test mode. No customer migration is needed. If a live Plus/Pro subscription ever exists before
   Phase 4, map it explicitly (decision): keep it until it is canceled ("grandfathered"), never silently change it.
4. **Server:**
   - `createCheckout` error copy ("Choose Plus or Pro") → generic.
   - Upgrade order in the limit gate (`upgradeTo` = next plan by allowance) works as is.
   - Env vars `STRIPE_FLASH_PRICE_ID`, `STRIPE_BOLT_PRICE_ID` and `STRIPE_THUNDER_PRICE_ID` follow the existing
     naming (`priceIdFor`); add them to `SERVER_ENV` in `vite.config.js`.
5. **Frontend:**
   - Remove `pricing-catalog.js` and the preview flag; the page renders `billing_plans` (the design already supports it).
   - The intro price must come from the server (status/plans endpoint), never from the browser.
   - Account page and limit gate copy: check them with the new names.
6. **Legal:** the Terms (still awaiting approval on `prelaunch/dev`) describe Free 60 min / Plus / Pro. They must be
   updated for the new lineup and the $1 first month before both are published.
7. **Tests:** SQL suites (billing, entitlement, AI limits) with the new keys; pricing page e2e in the harness.

## Phase 3: Stripe (test mode first)
1. `scripts/stripe-setup.mjs`: create three products and monthly prices (tax code SaaS personal use, tax-exclusive).
   Lookup keys keep prices idempotent. Add all three to the Customer Portal plan switcher.
2. **$1 first month, server-side:**
   - A Stripe coupon `amount_off 499, duration once`, applied by the server in Checkout (`discounts`), only for
     `flash`, only when the account is eligible. The browser never sends a discount.
   - Checkout then shows "$1.00 today, then $5.99/month".
   - **Eligibility (decision):** recommended "once per account, and only if the account never had a paid
     subscription", checked in the database (store `intro_redeemed_at`) and with Stripe's customer history.
   - An ineligible user sees $5.99 on the card and in Checkout, never $1.
3. **Plan changes:**
   - Upgrades are immediate with proration (current policy).
   - Decide how a Flash → Bolt upgrade during the $1 month is prorated: Stripe prorates from the list price, so
     the credit for the unused $1 month is small. Recommended: allow it and show Stripe's amount before
     confirming.
   - Downgrades: current policy is immediate with credit.
4. **Webhooks:** `planForPrice` maps the new prices automatically. Add tests for `checkout.session.completed` with a
   discount, the first renewal at $5.99, and promo reuse being refused.
5. **Economics:** a $1 payment nets about $0.67 after Stripe's card fee (2.9% + 30¢), before tax and AI cost. Keep
   Flash's AI budget low for the first month.

## Phase 4: production
Apply the migration, configure live Stripe (prices, coupon, portal, webhook), set the env vars, publish the updated
legal text, deploy, and smoke-test checkout on www.spark-scribe.com. This needs the existing launch approvals
(Vercel commercial plan, legal, Stripe live activation, final real-money authorization).
