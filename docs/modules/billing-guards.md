# Billing guards: what is refused before Stripe is touched (`server/billing/service.js`, `server/billing/config.js`)

[billing-service.md](billing-service.md) describes the operations; this page lists the **order of refusals**, because that
order is what keeps a half-configured deployment from charging anyone. Tests: `tests/billing-service-guards-test.mjs`
(the refusals below, with no Stripe client involved) and `tests/billing-config-test.mjs` (the environment switches).

## Environment switches (read on every call)
| switch | meaning |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_`/`rk_` + `test_`/`live_`. No key (or a malformed one) means billing is not configured. The key also decides test or live mode |
| `BILLING_PAYMENTS_ENABLED=1` | needed, together with a key, for **new payments** |
| `BILLING_LIVE_APPROVED=1` | additionally needed for a **live** key, for payments and for the portal |
| `BILLING_CHECKOUT_ALLOWLIST` | optional comma list of emails or account ids. Set, only those accounts may start a new checkout (the pilot). Unset, everyone may |

## `createCheckout` refuses in this order
1. `assertPaymentsEnabled()`: no key, key without `BILLING_PAYMENTS_ENABLED=1`, or live key without `BILLING_LIVE_APPROVED=1` → 503 `payments_unavailable`, "Nothing was charged."
2. The allowlist: an account not on it → the same 503 `payments_unavailable`.
3. `interval` must be exactly `month` or `year` (case matters) → otherwise 400 `bad_interval`.
4. Only after these does it create the Stripe client, load the plans and look up prices (`bad_plan`, `billing_not_configured`, `already_on_plan`, …).

So steps 1–3 need neither Stripe nor the database, and the guard test calls them with `sb = null` to prove it.

## `createPortal` is deliberately more open
The Customer Portal stays available when new payments are switched off, so an existing subscriber can always cancel or fix a card.
It refuses with:
- 503 `payments_unavailable` when billing is not configured, or a live key has no `BILLING_LIVE_APPROVED=1`;
- 404 `no_billing_account` when the `subscriptions` row is missing, has no Stripe customer, or belongs to the **other mode**
  (a test-mode customer is never served by a live key, and the reverse).

## `scheduledChange` returns `null` quietly
It never throws for "nothing to show": not configured (the database is not even asked), no `subscriptions` row, no
subscription id, or a subscription from the other mode all give `null`.

## `getStatus`
Any database error, or an empty answer, is one 503 `status_unavailable` ("Your plan couldn't be loaded. Try again.").
The database's own error text is not passed on to the user.
