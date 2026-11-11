# Billing display helpers (`src/lib/billing.js`)

Plans, usage and billing for the browser. **Display only**: what a user may actually do is decided on the server and in
the database (entitlements), never here. Plan names, prices and allowances come from the `billing_plans` table, the same
source the server uses.

> Not unit-tested yet: the module imports `src/lib/supabase.js`, which reads `import.meta.env` and cannot load under plain
> `node`. The pure formatters below would need to move to a separate file to be testable.

## Loading
- `loadPlans()` lists the four-tier lineup (Free, Flash, Bolt, Thunder) in tier order. Rows without a tier (retired plans) are never listed. Cached; returns `[]` when Supabase is not configured, and the cache is cleared on error so it can retry.
- `myPlan()` returns `{ plan, planName, features }` from the server's billing status, cached for the page, or `null` when it can't be read.
- `can(plan, capability)` and `planWith(plans, capability)` (the lowest plan that includes a capability).

## Server calls (`POST /api/billing`, bearer token)
`getBillingStatus`, `authorizeTranscription(durationSeconds)`, `startCheckout(plan, interval = 'month')`, `openPortal()`,
`deleteAccountOnServer()` (sends `confirm: 'DELETE'`). Failures throw `BillingApiError(message, code, status, extra)`:
`unauthorized` (401) without a session, `network` (0) when the request can't be sent.

## Formatting
| function | behaviour |
|---|---|
| `price(plan)` | `$5.99` from `price_cents`, `$0` for free |
| `perInterval(plan)` | `/month` unless the plan has a `billing_interval` |
| `allowanceLabel(seconds)` | `30 minutes`, or hours from 2 h up (`9 hours`) |
| `usageParts` / `usageText(used, total)` | `41 / 60 min` for small plans, `8.2 / 20 hr` from 2 h; never shows `60 / 60` while seconds remain |
| `durationText(seconds)` | `less than a minute`, `8 minutes`, `1 hour 5 minutes` |
| `dateText(iso)` | month and day in **UTC**, because resets happen at 00:00 UTC |
| `usageLevel(used, total)` | `ok`, `warn` from 80%, `high` from 95% |
