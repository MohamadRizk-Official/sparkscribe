# Environment variables

Every variable the code reads, written from the code (`server/`, `api/` and the browser code under `src/`). Values are
never listed here. Server variables are set in the Vercel project; `VITE_*` and `NEXT_PUBLIC_*` variables are read when the
site is **built** and end up in the browser bundle, so they must be public by design. Nothing secret belongs in them.

## Supabase (browser and server)
| variable | read by | meaning |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `src/lib/supabase.js`; `server/billing/config.js` | the project address and the `sb_publishable_` key. Both must be present for accounts to switch on (`isConfigured`); without them the transcription tool still works and account features hide |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | `server/billing/config.js` | fallbacks the server uses when the `NEXT_PUBLIC_` pair is not set |

## Database secrets (server only)
| variable | meaning |
|---|---|
| `BILLING_DB_SECRET` | proves to the database that a call comes from this server (webhook sync, saving Thunder history, billing writes) |
| `AI_DB_SECRET` | the same idea for AI usage settlement. Where it is missing the code falls back to `BILLING_DB_SECRET`, and `saveAcross` accepts either one |

## AI
| variable | meaning |
|---|---|
| `ANTHROPIC_API_KEY` | needed for summaries, Ask and the study tools. Without it the AI routes answer 503 `not_configured` ("Summaries and Ask aren't switched on for this site yet.") |
| `AI_MODEL` | one model for every task, when no per-task variable is set |
| `AI_MODEL_SUMMARY`, `AI_MODEL_INSIGHTS`, `AI_MODEL_TOOLS`, `AI_MODEL_ASK` | the model for one family of tasks (overview, detailed summary, notes and reduce use `_SUMMARY`; Insights uses `_INSIGHTS`; study guide, flashcards, quiz, study map, definitions, exam points, meeting recap, action plan, follow-up email, reply draft, interview Q&A, episode notes, combined guide and short-answer grading use `_TOOLS`; Ask, Ask across and question expansion use `_ASK`). A per-task variable wins over `AI_MODEL`, which wins over the built-in default |
| `AI_PROVIDER=mock` | use the offline stand-in provider. **Ignored when `VERCEL_ENV` is `production`**, so a production deployment can never serve canned answers |
| `AI_MOCK_FAIL=1`, `AI_MOCK_VERIFY`, `AI_MOCK_UNCOVERED=1` | make the mock provider fail every call, change what its verification step answers, or leave flashcard and quiz concepts uncovered. Only meaningful with `AI_PROVIDER=mock` |
| `AI_USAGE_LOG` | a file path. When set, each `[ai-usage]` line is also appended to it, **except on Vercel** (`VERCEL` set), where only the console line is written |

## AI usage limits
The check before every model call is `ai_reserve` in the database.
| variable | effect |
|---|---|
| `AI_LIMITS_REQUIRED=1` | once the migration is applied: a missing `ai_reserve` function refuses the call instead of letting it through unmetered, and a missing secret is reported at settlement |
| `AI_LIMITS_DISABLED=1` | operator emergency switch: skips the check entirely and logs `usage checks are OFF` once. Never set by default |

## Stripe and billing
See [modules/billing-config.md](modules/billing-config.md) and [modules/billing-guards.md](modules/billing-guards.md).
| variable | meaning |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_`/`rk_` + `test_`/`live_`. Decides whether billing is configured and whether it runs in test or live mode |
| `STRIPE_WEBHOOK_SECRET` | verifies webhook signatures (`api/stripe-webhook.js`) |
| `BILLING_PAYMENTS_ENABLED=1` | new payments are allowed (with a key) |
| `BILLING_LIVE_APPROVED=1` | additionally required for a live key, for payments and for the Customer Portal |
| `BILLING_CHECKOUT_ALLOWLIST` | comma list of emails or account ids; only they may start a new checkout. Unset means everyone |
| `STRIPE_<PLAN>_PRICE_ID`, `STRIPE_<PLAN>_YEARLY_PRICE_ID` | the Stripe price for a plan key (`FLASH`, `BOLT`, `THUNDER`) and interval. Must look like `price_…` |
| `STRIPE_<PLAN>_INTRO_COUPON` | the introductory-offer coupon for a plan (3–60 characters of letters, digits, `_`, `-`) |
| `STRIPE_PORTAL_CONFIGURATION_ID` | SparkScribe's own Customer Portal configuration (`bpc_…`). Required to change plans for someone already paying |
| `STRIPE_AUTOMATIC_TAX=1` | Checkout collects the billing address and adds the tax Stripe calculates |
| `STRIPE_REQUIRE_TOS=1` | Checkout makes the customer tick the Terms (needs the Terms URL in the Stripe account) |
| `STRIPE_API_HOST` | `127.0.0.1:<port>` only, and only off Vercel: points the Stripe client at a local stand-in for QA |
| `BILLING_SCOPE` | a short tag (`a-z`, digits, `:`, `-`, up to 40) used when several deployments share one Stripe sandbox; default `app` |
| `APP_URL` | `https://…` address Stripe sends people back to. If unset the request's host is used, but only for localhost, `sparkscribe*.vercel.app` and `spark-scribe.com` |

## Hosting
`VERCEL` (set on Vercel) and `VERCEL_ENV` (`production`, `preview`, `development`) are read to switch off local-only
behaviour: the mock provider in production, the usage log file and the local Stripe host.
`SPARKSCRIBE_DEV_HARNESS=1` lets the Vite dev server plug an in-memory store in for UI testing (`server/http.js`). It
is ignored whenever `VERCEL` is set and needs the request to opt in with a header as well.

## Build-time switches (browser)
| variable | meaning |
|---|---|
| `VITE_TURNSTILE_SITE_KEY` | the public Cloudflare Turnstile key. Without it no captcha is loaded (see [modules/captcha.md](modules/captcha.md)) |
| `VITE_PAID_PLANS=1` | only in the build that launches paid plans; until then the pricing page cannot start a payment |
| `VITE_REQUIRE_ACCOUNT=1` | the transcription page requires sign-in. Off by default |
| `VITE_ACCOUNT_DELETION=1` | shows account deletion in Settings once the database function exists |
| `VITE_NEMOTRON_F16_BASE` | replaces the download sources of the speaker model (local tests) |
