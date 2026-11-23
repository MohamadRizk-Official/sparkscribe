# `POST /api/billing`

Source: `api/billing.js`; logic in `server/billing/service.js` ([../modules/billing-service.md](../modules/billing-service.md)) and `server/billing/config.js` ([../modules/billing-config.md](../modules/billing-config.md)).

**The browser never names a user, customer, price or plan status.** The user is the one in the verified session token; the browser may send only a plan key and an interval, and the server maps them to its own Stripe price.

`POST` only (`405 method_not_allowed`). The body is read first, then the user is checked (`Bearer` token verified with `auth.getUser`; failures are `401 unauthorized`).

| `action` | body | result |
|---|---|---|
| `status` | `detail?` | plan, usage and renewal date, plus `upgradesAvailable`, `yearlyAvailable`, `testMode`; `scheduledChange` only when `detail === true` |
| `authorize` | `durationSeconds` | whether a recording this long may be transcribed now |
| `checkout` | `plan` (`flash`, `bolt`, `thunder`), `interval` (`month`/`year`, default `month`) | `{ url }` for Stripe Checkout, or a plan change for paid users |
| `portal` | none | `{ url }` for the Stripe Customer Portal |
| `delete_account` | `confirm: "DELETE"` | cancels the Stripe subscriptions, then deletes the account; anything but the exact word is `400` "Type DELETE to confirm." |

## The flags in `status`
- `upgradesAvailable`: payments are enabled, checkout is allowed for this user, and **every paid plan has a Stripe price**.
- `yearlyAvailable`: the same, and every paid plan also has a yearly price on the site and in Stripe.
- `testMode`: billing is configured and the key is not live (the Preview deployment).
- `scheduledChange`: one extra Stripe read, requested by the Account page; if it fails the status still succeeds (`null`).

## Errors
- `BillingError` keeps its status, code, message and any `extra` fields.
- Any other failure (Stripe, network) is `502 billing_unavailable` with "Billing isn't responding right now. Nothing was charged. Try again in a moment." Only the error's type or name is logged.
