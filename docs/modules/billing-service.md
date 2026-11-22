# Billing service (`server/billing/service.js`)

The server side of plans, quota and Stripe. Written from the code; the design notes live in
`docs/launch/20-billing-four-tier.md` and the configuration side in [billing-config.md](billing-config.md). Almost all
of it talks to Stripe and Supabase, so it is exercised by the real-service scenarios under `qa/` and `scripts/`
(`npm run test:sql` for the database half) rather than by `npm test`.

Principle at the top of the file: **every decision about what a user may do comes from the database (entitlements) and
Stripe (subscriptions). Nothing the browser says about its plan is trusted.**

## Operations
| function | what it does |
|---|---|
| `getStatus(sb)` | calls the database function `billing_status`; any error → `BillingError` 503 `status_unavailable` |
| `authorize(sb, seconds, user)` | may this user start transcribing a recording of `seconds`? |
| `createCheckout(sb, user, planKey, origin, interval)` | Stripe Checkout for a new subscription, or a Customer Portal plan-change for someone already paying |
| `scheduledChange(sb, user)` | a plan change the customer scheduled in the portal (a downgrade starts at the next renewal), for the Account page |
| `createPortal(sb, user, origin)` | Customer Portal for the user's own Stripe customer |
| `handleEvent(event)` | one verified Stripe webhook event → stored subscription state |
| `deleteAccount(sb, user)` | cancel billing in Stripe, then delete the account |

## `authorize`: the quota check before transcription
- The length must be a finite number, greater than 0 and at most `MAX_SECONDS` (360 000 s = 100 h); otherwise 400
  `bad_request` "Invalid recording length.".
- The answer always carries `plan`, `remainingSeconds`, `monthlySeconds`, `periodEnd`, `upgradeTo` (the first paid plan
  with a bigger monthly allowance) and `upgradesAvailable` (payments switched on, checkout allowed for this user, and a
  Stripe price configured for that plan).
- If the database says quota is not **enforced** (the launch switch in `billing_settings`), the answer is
  `{ ok: true, enforced: false }` whatever the length.
- When enforced, a recording may be up to **one second longer** than the remaining time (matching the database check).
  Beyond that: `{ ok: false, reason }`, where the reason is `limit_reached` if less than one second remains and
  `too_long` otherwise. The refusal is logged as `usage_rejected`.
- The database re-checks when the transcription is saved, so this is a courtesy check, not the only gate.

## `createCheckout`
Order of checks (nothing is charged by any of them):
1. payments switched on (`assertPaymentsEnabled`), then `checkoutAllowedFor(user)`; otherwise 503 `payments_unavailable`;
2. `interval` is `month` or `year` (`bad_interval`); the plan exists and is a paid plan (`bad_plan`);
3. a Stripe price exists for that plan and interval. Yearly additionally needs a yearly price on the plan row
   (`billing_not_configured`), so the page and the charge always agree.

Then:
- **Already paying** (status `active`, `trialing` or `past_due`): the same price → 409 `already_on_plan`; a different
  price → a Customer Portal session with a `subscription_update_confirm` flow (Stripe shows the prorated amount, the
  user confirms). Needs SparkScribe's own portal configuration (`STRIPE_PORTAL_CONFIGURATION_ID`, a `bpc_…` id); without
  it → `billing_not_configured`. No second subscription is ever created. Returns `{ url, kind: 'change' }`.
- **New subscription:** only on **monthly** billing, and only when the database says `introEligible`, the plan's
  introductory coupon is applied (Flash: $1 first month). If the coupon is not configured the checkout is refused
  (`intro_unavailable`) rather than charging a price the page did not show. Yearly never gets the intro price, and
  customers cannot enter promotion codes.
- Checkout sessions this customer left open are expired first, and a never-paid `incomplete` subscription is
  cancelled, so at most one can be paid.
- The renewal terms ("$X today, then $X every month/year until you cancel", the monthly renewal of the hours on a
  yearly plan) are placed next to Stripe's pay button. `STRIPE_REQUIRE_TOS=1` also asks the customer to tick the Terms.
- Metadata on the session and the subscription: `supabase_user_id`, `plan`, `interval`, `intro` (`'1'`/`'0'`) and
  `sparkscribe_scope`. Returns `{ url, kind: 'checkout' }`.

### One Stripe customer per account
`ensureCustomer` reads the stored link. A test-mode server (a Preview sharing the production database) never replaces a
real customer link: 409 `live_account`. A new customer is created with an idempotency key per user and mode, linked
through the database function `billing_link_customer`; if a concurrent request linked a different one first, the extra
customer is deleted and the linked one is used.

## `handleEvent`: webhooks
Returns `{ status, body }` for the HTTP handler. Steps, in order:
1. **Wrong mode** (event `livemode` differs from the server's) → 200 `ignored: other_mode`.
2. **Wrong deployment scope** (the object's `sparkscribe_scope` metadata differs from `billingScope()`) → 200
   `ignored: other_scope`. Untagged (older) objects are not filtered.
3. **Idempotency:** `billing_event_begin` records the event id; anything but `new` → 200 `duplicate: true`.
4. Handled event types:
   - `checkout.session.completed`: subscription mode only; the user id must be a UUID; the customer is linked (refused
     if it belongs to another user); the subscription is synced; the intro offer is marked used **only** when the
     session carried it, a discount was really applied and the payment status is `paid`; then duplicate subscriptions
     are settled.
   - `customer.subscription.created / updated / deleted / paused / resumed`: sync; duplicates are settled after
     `created` and `resumed`.
   - `invoice.paid / payment_failed / payment_action_required`: sync the invoice's subscription; the result is
     `synced` for `invoice.paid` and `payment_problem` for the other two.
   - anything else: acknowledged and ignored.
5. **Failure handling:** an error whose message contains `unknown_customer`, `user_mismatch`, `mode_mismatch`,
   `customer_belongs_to_another_user` or `unknown_user` is a **final refusal**: recorded as `refused:<reason>`, answered
   200 so Stripe does not retry, and never grants access. Any other error → 500 `processing_failed`, which Stripe retries.
   For `unknown_user` / `unknown_customer` the server first tries to relink from the subscription's metadata, and if
   the account really is gone it cancels the orphan subscription (and refunds a payment made after the account was gone).

Syncing always re-reads the subscription from Stripe, so late or out-of-order events cannot leave stale state. The
account stores its customer's **paying** subscription (the oldest one that still gives access) whichever subscription
the event was about; if two Checkouts were paid at the same moment the newer one is cancelled and refunded.

## `deleteAccount`
1. `account_deletion_check` confirms a recent sign-in without deleting anything (`reason: 'reauth'` → `{ deleted: false }`).
   A missing function means the feature is not switched on yet (503 `deletion_unavailable`).
2. Every unfinished subscription of the customer is cancelled in Stripe at once (no proration) and synced.
3. `delete_my_account` removes the account; 4. the Stripe customer is deleted (saved cards go; invoices stay for accounting).
If Stripe cannot be reached, nothing is deleted. If the account cannot be deleted after a cancellation, the message says
the subscription **was** cancelled.
