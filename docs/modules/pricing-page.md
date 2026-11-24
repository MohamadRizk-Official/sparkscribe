# Pricing page (`src/pages/pricing.js`)

The `/pricing` page: plan cards, the "which plan fits" section, the comparison table and the FAQ. It is **presentation only**. Prices, allowances, introductory prices and what each plan includes come from the `billing_plans` table through `loadPlans()` (`src/lib/billing.js`), the same rows the server's entitlement checks use. The page never chooses a Stripe price: it sends a plan key (and `month` or `year`) to `/api/billing`, and the server decides what is charged.

## Start-up (`main`)
1. Mounts the account menu if Supabase is configured.
2. Remembers a safe `?next=` path in `sessionStorage` (`sparkscribe.afterUpgrade`) so a feature that needs a plan can send the student back after upgrading. Only same-site paths made of `[\w\-./?=&%,]` are kept.
3. Shows "Checkout canceled" when `?checkout=canceled`.
4. Loads the plans. No plans: shows "Plans couldn't be loaded" with a refresh link and stops.
5. If signed in, loads the billing status (`getBillingStatus`). A plan that is no longer in the lineup is explained ("an earlier plan… stays exactly as it is").
6. Renders the billing switch, cards, "why" section, comparison and FAQ.
7. Continues an interrupted upgrade (`?plan=<key>` after signing in) or highlights a card (`?highlight=<key>`, e.g. from Thunder's "Ask across recordings"). Highlighting never starts checkout.

## When can anything be bought?
Paid plans can be started only when **both** are true:
- the build has `VITE_PAID_PLANS=1`, and
- the server says so: `status.upgradesAvailable` for monthly, `status.yearlyAvailable` for yearly (signed-out visitors see the sign-in button instead).

Otherwise the cards show "Coming soon", the footer reads "Paid plans coming soon · the Free plan is available today", and a notice says nothing on the page can charge the visitor. In test mode a banner says only Stripe test payments are used.

## Monthly and yearly
`?billing=year` selects yearly prices, but yearly is shown only when **every** paid plan has a yearly price (`hasYearly`, `src/lib/pricing-catalog.js`). The $1 first-month offer is monthly-only: `introFor` returns no intro while yearly is selected, and also when the server reports the customer is not eligible (`introEligible === false`).

## Card buttons (`ctaFor`)
| situation | shown |
|---|---|
| the customer's current plan | "Your current plan" |
| the Free card, signed out | a link to sign in |
| the Free card, on a paid plan | "Included when a paid plan ends" |
| a paid card, not purchasable yet | "Coming soon" |
| a paid card, signed out | a sign-in link that returns to `/pricing?plan=<key>` (plus `&billing=year`) |
| a paid card, signed in | a button; "Switch to …" when already on a paid plan; "Opening secure checkout…" while busy |

`upgrade(plan)` ignores a second click while one is in flight, then calls `startCheckout`, which navigates to Stripe. On failure it re-enables the buttons and shows the error with "Nothing was charged".

## Related
- Formatting helpers: [pricing-catalog.md](pricing-catalog.md) (tests: `tests/pricing-catalog-test.mjs`, `tests/pricing-yearly-edges-test.mjs`).
- Billing display helpers: [billing-display.md](billing-display.md).
- Server side: [billing-service.md](billing-service.md), [entitlements.md](entitlements.md).

Browser-only: the page has no automated test of its own (it reads the DOM and `location`).
