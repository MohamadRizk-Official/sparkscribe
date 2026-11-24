# Account page (`src/pages/account.js`)

`/account`: the current plan, this period's transcription usage, the renewal or cancellation date, upgrade buttons and **Manage Billing**. Everything shown comes from the server's `billing_status` (`getBillingStatus({ detail: true })`). After Checkout the page **waits for Stripe's webhook** to confirm the subscription: it never assumes the payment worked because the return URL says so.

The page needs a signed-in user (`requireUser`). A load failure shows the error with a "Try again" link.

## What `render()` shows
- **Current plan card**: name, price (`/year` for a yearly subscriber), a "when" line, the allowance, included premium features and the action buttons.
- **Transcription meter** (`meterHtml`, exported): `used / total` in the plan's unit, time left, and a level (`ok` / `warn` / `high`, see [billing-display.md](billing-display.md)). At `high` with a higher plan available it names that plan and its allowance; at `warn` it says most of the time is used.
- **Other plans / Upgrade** list of every higher plan (by `tier`); the next tier is offered first.
- A test-mode note when Stripe is in test mode.

The "when" line, by precedence: Free → "Resets <date>"; cancelling → "Your <plan> plan remains active until <date>" (plus a neutral cancellation notice built from the status); a scheduled plan change → "Switches to <plan> on <date>. Until then you keep <plan>."; yearly → "Billed yearly · renews <date>. Your transcription time renews <date>."; otherwise "Renews <date>". A payment problem shows a red alert ahead of everything: a paid plan stays active while Stripe retries, and Manage Billing becomes the primary button.

## Buttons
| button | shown when |
|---|---|
| Upgrade / Switch to <next plan> | a higher plan exists, the server allows it (`upgradesAvailable` for monthly, `yearlyAvailable` for yearly) and the plan is not set to cancel. A yearly subscriber stays on yearly billing |
| Switch to yearly · price, save … | a monthly subscriber whose plan has a yearly price (`hasYearly`), yearly is available and the plan is not cancelling; confirmed in Stripe's portal |
| Manage Billing | the customer has a billing account (`hasBillingAccount`) |
| Compare plans | always (link to `/pricing`) |

`act(name, fn)` runs one action at a time (`busy`), re-renders the buttons as "Opening…", and on failure shows the message with "Nothing was charged".

## Return from Checkout
- `?checkout=success` (the query is cleaned straight away): if the plan is still Free, `waitForActivation` polls the status up to 20 times (every 1.5 s for the first five tries, then every 3 s, about a minute in all) until the plan changes. On success it greets the customer and, if `sparkscribe.afterUpgrade` holds a same-site path, offers "Continue where you left off". On timeout it says the payment is being confirmed and that they won't be charged twice.
- `?changed=1`: "Your plan change is being applied" and one refresh of the status after 4 s.

Related: [pricing-page.md](pricing-page.md), [billing-service.md](billing-service.md), [../api/billing.md](../api/billing.md), [../api/stripe-webhook.md](../api/stripe-webhook.md).

Browser-only: no automated test of its own.
