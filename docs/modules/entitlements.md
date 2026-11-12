# Plan gating (`server/entitlements.js`)

Premium features (Bolt, Thunder) are checked on the server, never in the browser. `requireCapability(db, capability)` runs **before** any recording is loaded or any AI call is made, so a refused request costs nothing and uses no allowance.

## Capabilities
| key | label | wording |
|---|---|---|
| `focused_review` | Focused Review | singular ("is included with…") |
| `followup_practice` | New practice questions | plural ("are included with…") |
| `across_ask` | Asking across recordings | singular |
| `across_guide` | Combined study guides | plural |

The table is frozen. Asking for a key that isn't in it throws a plain `Error` (a programming mistake, not a user-facing refusal).

## What it does
1. Calls `db.entitlements()` and expects `{ features: [...], plan, plans: [...] }`.
2. If the capability is in `features`, returns the entitlements object.
3. Otherwise throws an `AIError` with status **403**, code `plan_required`. The message names the plans that include the capability (sorted by tier, joined with "and"), or "a higher plan" if none is known. `details` carries `capability`, the cheapest plan that has it (`plan`, `planName`, or `null`), and the user's `current` plan.

Plans with no `tier` (retired plans) are ignored when suggesting an upgrade.

## Failing closed
If the plan can't be determined (no `entitlements` function, a `null` result, `features` that isn't an array, or the lookup throws), the user gets **503 `plan_unavailable`** ("Nothing was used. Try again in a moment."). An unknown plan is never treated as entitled.

Covered by `tests/entitlements-test.mjs`.
