# Pre-launch development (LLC pending) — progress log

Branch `prelaunch/dev` (from `qa/v1-release` 327b3b4). Production `main` = 95bf377 (unchanged). v1 engine 7ce03f9 (unchanged).
Preview: https://sparkscribe-git-prelaunch-dev-moerizz.vercel.app (public: Deployment Protection is off; shares the
production Supabase project). Authorized: commits, pushes of this branch, Vercel Previews. Not authorized: merge to main,
production deploy, production data/migrations/env, DNS, auth-provider changes, live payments.

## Current phase
Done. Handoff report: `docs/launch/PRELAUNCH-REPORT.md`.

## Log
| # | Work | Status | Commit |
|---|---|---|---|
| P0 | State check: qa head 327b3b4, main 95bf377, engine 7ce03f9, reports read | done | — |
| P1 | Merge `phase-6-billing` (10 commits) into `prelaunch/dev`; conflicts resolved toward the RC | done | 327d5e0 |
| P1a | Kept on-device transcription without an account (the billing branch forced sign-in) → `VITE_REQUIRE_ACCOUNT` | done | 327d5e0 |
| P1b | Server payments switch: Checkout needs key + `BILLING_PAYMENTS_ENABLED=1` (+ `BILLING_LIVE_APPROVED=1` for live); portal stays open for existing subscribers | done | 327d5e0 |
| P1c | Pricing "Coming soon" unless `VITE_PAID_PLANS=1` and the server reports upgrades | done | 327d5e0 |
| P1d | Stray `=======` from the merge broke the production build; caught by the build, fixed before commit | fixed | 327d5e0 |
| P2 | Billing tests: database 42 (plans, metering, quota, upgrade/renewal/cancel/past_due, stale/foreign events, idempotency, secret gate, RLS); server 29 (payments switch, checkout vs fake Stripe, webhook signature/replay/duplicate/mode/foreign) | done | 793e449 |
| P3 | Billing UI: offline billing mock in the harness (harness can no longer reach production via /api/billing — it briefly did, a rejected token check only); shared header; UTC reset dates (showed Oct 31 for a Nov 1 reset); /account → "Plan & usage"; e2e billing 8/8 | done | 0389585 |
| P4 | Preview checkpoint pushed; Preview build identical; protection off (public) | done | 0389585 |
| P5 | Email: sparkscribe.ai identified; DNS shows Microsoft 365 + DMARC p=reject but **no SPF / no DKIM** (company mail likely rejected); exact Resend/GoDaddy/Supabase steps; branded templates | prepared (needs your accounts) | 98f9bca |
| P6 | Draft /privacy and /terms (generated from docs/launch, "Draft" banner, review notes highlighted), refunds/cancellation section, footer + sign-up links; e2e legal 2/2 | done | 98f9bca |
| P7 | axe-core scan (8 pages + 5 transcript tabs × light/dark): 11 light-theme contrast failures → fixed (0 serious/critical). Phone layout 320/375: /library overflowed at 320 → fixed | done | 721dbee |
| P8 | Appearance suite 5/5; `npm run test:sql` | done | 806ed68 |
| P9 | Full regression: unit 186, SQL 143, browser 80/80 (14 suites), axe 0, layout 0, real-model transcription WER 0 on the production build; Preview checks | done | 806ed68 |
| P10 | `.env.example` documents every billing switch | done | 81a14e8 |
| P11 | Anonymous use vs Free 60 min: verified (counted only at save, enforced in the DB; AI via ledger); fixed raw `quota_exceeded` + useless Retry on "sign in to save" → plain message + Download text; analysis `docs/launch/10` | done | 70cf937, 8631c0d |
| P12 | Preview exposure audit (protection off, 40+2 public deployments, noindex, no source maps, old CLI deployments hold a private recording in source only) + exact protection steps `docs/launch/11` | done (no settings changed) | 00d3c45 |
| P13 | Domain: RDAP (GoDaddy, 2025-04-29, privacy proxy) — ownership not provable publicly; `scripts/check-email-dns.mjs <domain>`; email doc no longer assumes the domain | done | 6d344f5 |
| P14 | Billing copy while payments off: footers no longer advertise Stripe; FAQ says only saved recordings count | done | 6d344f5 |
| P15 | Legal launch guard: production builds fail while /privacy or /terms are drafts; `build-legal.mjs --final` refuses with notes/placeholders left (19+6 / 14+5 today) | done | 6d344f5 |
| P16 | Regression for changed code: unit 190, pending-privacy 7/7, billing pricing/account 3/3, home-save 8/8, Preview verified | done | 00d3c45 |
| — | Isolated real Supabase stack: Docker Desktop fails at start on this PC (stale `dockerInference` socket). Not reset (your system). Used PGlite / real Postgres + fakes | blocked (environment) | — |

## Blockers needing you
- Domain/email accounts (GoDaddy, Microsoft 365, Resend, Supabase SMTP), Vercel Deployment Protection, legal review,
  plan decisions, approvals for migrations/env/merge. See the report.
- Docker stays optional. Docker Desktop on this PC stops at start-up (stale `%LOCALAPPDATA%\Dockerun\dockerInference`
  socket). Non-destructive fixes only: restart Windows, then start Docker Desktop; if it persists, update Docker Desktop.
  Do **not** use "Clean / Purge data" or "Reset to factory defaults" (they delete containers and volumes).
