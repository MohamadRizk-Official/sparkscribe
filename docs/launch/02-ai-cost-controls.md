# AI cost controls — production readiness

Status: **ready to apply** (`supabase/proposed/20261012100000_ai_usage_limits.sql` + server code on `qa/v1-release`).
Nothing is applied. **Production today has no AI limits at all:** every signed-in user can generate without limit.
The plan below enforces limits from the first request of the new release. Free use is never left unlimited to collect data.

## 1. Measured costs (production data, read-only, 2026-10-12)

Haiku 5.5 at the code's price table: $0.10 per million input tokens, $0.50 per million output, 5× above 100k prompt tokens.
**[CONFIRM against your Anthropic invoice.]**

| Action | Samples | Avg input / output tokens | Avg cost |
|---|---|---|---|
| Ask | 19 | 2,928 / 298 | $0.00044 |
| Overview | 17 | 2,556 / 736 | $0.00062 |
| Insights | 9 | 3,742 / 1,442 | $0.00110 |
| Notes | 12 | 3,106 / 1,888 | $0.00125 |
| Reply draft | 5 | 2,406 / 357 | $0.00042 |
| Quiz | 6 | 3,223 / 2,677 | $0.00166 |
| Action plan | 1 | 10,021 / 2,347 | $0.00218 |
| Study guide | 1 | 7,902 / 5,126 | $0.00335 |
| Quiz short-answer grading | (bounded prompt) | ≤ ~600 / ~150 | ≈ $0.00014 |

A typical session on one recording (overview, notes, one Create tool and three questions) costs about **$0.005**.

## 2. Initial limits

| Plan | Per hour | Per month (model cost) | What that means | Status at launch |
|---|---|---|---|---|
| **Free** | 20 actions | **$0.15** | about 30 full sessions a month; heavy use is cut off at $0.15 per user | everyone (billing paused) |
| Plus ($7.99) | 120 | $1.50 (19% of price) | about 300 sessions | not purchasable yet |
| Pro ($14.99) | 240 | $3.50 (23% of price) | about 700 sessions | not purchasable yet |
| **Service-wide breaker** | — | **$5 per 24 h across all users** | stops sign-up-bot multiplication; caps the worst month at about $150 | on |
| Always-on ceiling | 1,000 per user per hour | — | stops direct-call flooding | on |

**Expected AI spend** (assuming an active Free user runs about 6 sessions a month, about $0.03):
- 100 active users: about $3 a month.
- 1,000 active users: about $30 a month.
- Hard ceiling: $150 a month via the breaker.

Raise the breaker deliberately as you grow: `update public.billing_settings set ai_daily_budget_microusd = 10000000`.

**Provider backstop (you):** set a monthly spend limit in the Anthropic Console (for example $50) so that even a
software fault can't run up a large bill. **[CONFIRM the limit option on your Anthropic plan.]**

## 3. What was verified

| Requirement | Result | Where |
|---|---|---|
| Free / Plus / Pro entitlements | Free default; Plus 120 and $1.50; Pro 240 and $3.50 (active, trialing, past_due); canceled falls back to Free at once; an unknown plan falls back to Free limits | SQL tests |
| Atomic reservations | 50 simultaneous connections on real PostgreSQL → exactly 20 allowed; without the lock, 50 of 50 (the test detects races); per-user lock | `qa/sql/concurrency.test.mjs` |
| Monthly and hourly limits | both enforced; deleting results never frees quota; a refused request adds no row and calls no model | SQL + server + browser |
| Correct settlement | cost = the price table applied to real tokens (Ask average → 442 µ$); long-prompt rate; settles exactly once; needs the server secret; a user can't settle someone else's row | unit + SQL |
| Failed requests | real cost recorded for accounting and the service-wide total; **not** charged to the user's allowance; still counts toward the hourly limit | SQL |
| Abandoned requests | a function killed before settling stays `reserved` and counts at its estimate | SQL |
| Cached results | never reserve and never settle | unit |
| Safe denial | network, timeout, database error, a thrown client, a malformed reply, missing limits or periods → refused (503 "briefly unavailable"), never unmetered | unit + SQL |
| Rollout fallback | runs unmetered only when the function doesn't exist **and** `AI_LIMITS_REQUIRED` is unset | unit + live PostgREST check |
| Emergency disable | `enforce_ai_limits = false` (per-user limits off, instant); `ai_daily_budget_microusd = null` (breaker off); `AI_LIMITS_DISABLED=1` (skips all checks; logged) | SQL + unit |
| User-facing messages | hourly: "Try again in about N minutes"; monthly: "renews on <date>"; breaker: "AI tools are paused… Transcription still works"; check down: "briefly unavailable. Nothing was used" — all shown as notices | browser 5/5 |

## 4. Production configuration

| Variable | Production | Preview | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | exists | exists | — |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | exist | exist | **Preview and Production use the same database** |
| `BILLING_DB_SECRET` | **add** | exists | must match the hash stored as `private.billing_secrets.name = 'server'` (option A or B below) |
| `AI_LIMITS_REQUIRED` | **add `1`** | **add `1`** | once the migration is applied |
| `AI_LIMITS_DISABLED` | never | never | emergencies only |

The secret, two options (you, in Vercel; never in chat):
- **A.** If you still have the value used for Preview's `BILLING_DB_SECRET`, add the same value to Production.
- **B.** Otherwise, generate a new one (`openssl rand -hex 32`) and put it in **both** Production and Preview
  `BILLING_DB_SECRET`. Then I run, with your approval:
  `update private.billing_secrets set hash = extensions.digest('<value>', 'sha256') where name = 'server';`
  You can instead run it yourself in the SQL editor, so the value never passes through me.
- Check afterwards: `select status, count(*), sum(cost_microusd) from public.ai_usage group by 1;` should show `done`
  rows with real costs, not rows stuck at `reserved`.

## 5. Rollout (part of the deployment plan)

1. Apply the migration. It creates the ledger, the limits, the breaker ($5/day) and `enforce_ai_limits = false`.
   Production's current code doesn't call it.
2. `update public.billing_settings set enforce_ai_limits = true;` — still no effect on the current code.
3. Set the secret and `AI_LIMITS_REQUIRED=1`, then deploy the release. Limits apply from its first request.
4. Week 1: review `ai_usage` daily (spend, refusals, `reserved` leftovers) and adjust with UPDATEs.
