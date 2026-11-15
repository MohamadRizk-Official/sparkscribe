# Plan and price formatting (`src/lib/pricing-catalog.js`)

Formatting only. Plans (prices, allowances, intro prices) come from the database `billing_plans` rows via
`lib/billing.js loadPlans`; Checkout charges what the server and Stripe decide. Test: `tests/pricing-catalog-test.mjs`.

| Function | Result |
| --- | --- |
| `planFromRow(row)` | row with `features` always an array and `intro: { price_cents, months }` or `null` (months defaults to 1) |
| `money(cents)` | `$5.99`; whole dollars without cents (`$1`, `$0`) |
| `allowance(seconds)` | under an hour: `{ num: "30", unit: "min", long: "30 minutes" }`; otherwise hours to one decimal, `hour` vs `hours` |
| `times(a, b)` | ratio of monthly allowances, e.g. `3×` |
| `perHour(p)` | regular price per allowance-hour, `null` for a free plan; never uses the intro price |
| `priceGap(a, b)` | absolute regular price difference |
| `priceLines(p)` | free: `$0 /month, "No card needed"`; with intro: first-month price plus "Then $X/month"; else `$X /month` and a renewal sentence. The first-month and renewal price are always shown together |

## Yearly
`hasYearly` needs `billing_interval` and `yearly_price_cents`. `yearlySavings` is measured against 12 regular months
(never the $1 month); `yearlySavingsPct` rounds; `perMonthOfYearly` rounds **up** to the cent; `yearlyPriceLines` states
that the transcription time still renews monthly.
