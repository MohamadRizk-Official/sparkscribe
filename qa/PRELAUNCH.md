# Pre-launch development (LLC pending) — progress log

Branch `prelaunch/dev` (from `qa/v1-release` 327b3b4). Production `main` = 95bf377 (unchanged). v1 engine 7ce03f9.
Authorized: commits, pushes of this branch, Vercel Previews. Not authorized: merge to main, production deploy,
production data/migrations/env, DNS, auth-provider changes, live payments.

## Current phase
P2 — billing tests (database + webhook/checkout).

## Log
| # | Phase / work | Status | Commit |
|---|---|---|---|
| P0 | State check: qa head 327b3b4, main 95bf377, engine 7ce03f9, reports read | done | — |
| P1 | Merge `phase-6-billing` (10 commits) into `prelaunch/dev`; conflicts resolved toward the RC | done | 327d5e0 |
| P1a | Kept on-device transcription without an account (billing branch had a sign-in gate) → `VITE_REQUIRE_ACCOUNT` | done | 327d5e0 |
| P1b | Server payment switch: Checkout needs key + `BILLING_PAYMENTS_ENABLED=1` (+ `BILLING_LIVE_APPROVED=1` for live); portal stays open for existing subscribers | done | 327d5e0 |
| P1c | Pricing "Coming soon" unless `VITE_PAID_PLANS=1` and server reports upgrades | done | 327d5e0 |
| P1d | Merge left a stray `=======` in CSS → production build failed; found by the build, fixed before commit | fixed | 327d5e0 |
| — | Isolated real Supabase stack: Docker Desktop fails to start on this machine (stale `dockerInference` socket; "needs to close" dialog). Not reset (your system). Using PGlite / real Postgres + fakes instead | blocked (environment) | — |

## Blockers needing you
- Docker Desktop on this PC shows an error at start-up (stale `%LOCALAPPDATA%\Docker\run\dockerInference`). A restart of
  Windows or Docker's "Troubleshoot → Clean/Purge data" would fix it; only then can a local Supabase stack run.
