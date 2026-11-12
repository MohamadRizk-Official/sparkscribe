# Billing configuration (`server/billing/config.js`)

All Stripe/billing switches are read on the server here. The UI only mirrors them.

## Taking money needs three steps
`paymentsEnabled(env)` is true only when:
1. `STRIPE_SECRET_KEY` looks like `sk_test_…`, `sk_live_…`, `rk_test_…` or `rk_live_…`,
2. `BILLING_PAYMENTS_ENABLED` is exactly `"1"`, and
3. for a **live** key, `BILLING_LIVE_APPROVED` is exactly `"1"`.

`assertPaymentsEnabled()` throws 503 `payments_unavailable` ("Nothing was charged.") otherwise.

## Other gates
- `portalAllowed(env)`: the Customer Portal stays open whenever a key is configured (existing subscribers can always cancel); live keys still need `BILLING_LIVE_APPROVED`.
- `checkoutAllowedFor(user, env)`: `BILLING_CHECKOUT_ALLOWLIST` is a comma list of emails or account ids (case-insensitive). Unset or blank means everyone.
- `automaticTax(env)`: on only when `STRIPE_AUTOMATIC_TAX` is `"1"`.
- `isLiveMode()` / `billingConfigured()` decide from the key's prefix.
- `getStripe()` throws 503 `billing_not_configured` for a missing or malformed key.

## Prices and coupons
- `priceIdFor(plan, interval)` reads `STRIPE_<PLAN>_PRICE_ID` (month) or `STRIPE_<PLAN>_YEARLY_PRICE_ID` (year). Unknown intervals, unset variables and values not shaped like `price_…` give `null`. Prices are never taken from the browser.
- `introCouponFor(plan)` reads `STRIPE_<PLAN>_INTRO_COUPON`; invalid ids give `null`.
- `billingScope()` tags Stripe objects so deployments sharing one sandbox ignore each other's objects: `BILLING_SCOPE` if it matches `[a-z0-9:-]{1,40}`, else `app`.

## Where Stripe sends people back
`appOrigin(req)` allows only `APP_URL` (https), localhost, `sparkscribe*.vercel.app` and `spark-scribe.com`; anything else is a 400 `bad_origin`. The first `x-forwarded-host` value is used.

Covered by `tests/billing-config-test.mjs`.
