# Stripe Tax for SparkScribe (prepared 2026-10-15)

Owner decision: use Stripe Tax. Monitor obligations, and calculate tax only where HRstudios LLC is legally required **and
registered** to collect it. Don't register everywhere. Prices stay $7.99 (Plus) and $14.99 (Pro), with tax added on top
and shown at Checkout. This is a summary for planning, not tax advice: confirm with a tax advisor before collecting.

## What the code does (off until switched on)
- `STRIPE_AUTOMATIC_TAX=1` (server env): Checkout turns on `automatic_tax`, requires a billing address and saves it to
  the Stripe customer. Stripe adds tax only for jurisdictions with an **active registration** in Dashboard → Tax →
  Registrations; everywhere else the tax is $0. Plan switches in the Customer Portal keep the subscription's tax setting.
- `scripts/stripe-setup.mjs` gives both products the tax code **txcd_10103000** (SaaS, personal use) and creates new
  prices as **tax-exclusive** (tax added on top). Test: `qa/sql/billing-server.test.mjs` (off by default; on adds tax).

## Classification
SparkScribe is software accessed through the browser (SaaS). Transcription runs in the user's browser, and the AI
features run on our servers. No physical goods, no downloadable app.
- **Michigan:** Michigan generally does not tax remotely accessed software (SaaS), but it does tax prewritten software
  delivered electronically. SparkScribe's code runs in the browser as part of a website, which is normally treated as
  remote access. **Ask the advisor to confirm** that this classification is right for SparkScribe.
- **Other states:** about half of US states tax SaaS in some form (for example Texas, New York, Washington, Pennsylvania,
  Ohio, Tennessee, Utah, Connecticut and Iowa, often at reduced or partial rates). An obligation to collect starts only
  with nexus. For a remote seller that is economic nexus, usually about $100,000 of sales in the state in a year (some
  states also count transactions).
- **Outside the US:** many countries (EU VAT, UK VAT, Canada GST/HST, Australia GST) tax digital services sold to
  consumers from the first sale or above a low threshold. Collecting there requires registering in that country; until
  then, Stripe does not calculate it.

## Steps for the owner in the Stripe Dashboard (live mode, after activation)
1. Tax → Settings: origin address = the LLC's business address; default product tax code = SaaS personal use;
   "Include tax in prices" = **No** (exclusive).
2. Tax → Registrations: add **only** the registrations you actually hold (Michigan, if the advisor says it applies).
3. Tax → Monitoring (threshold tracking) shows each state approaching economic nexus. Register there when it says so,
   then add the registration in Stripe.
4. Then set `STRIPE_AUTOMATIC_TAX=1` in the Production environment and redeploy.

Stripe Tax costs 0.5% per transaction where tax is calculated (check Stripe's current pricing). Filing returns is
separate: file them yourself, or use Stripe's filing partner.
