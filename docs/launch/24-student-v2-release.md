# student/v2 → Production: release runbook

**Status (2026-10-17):** legal pages finalized with the owner's decisions (effective October 17, 2026); the production
build with `REQUIRE_FINAL_LEGAL=1` passes; all suites green (docs/launch/23-student-v2-qa.md). Released by
fast-forwarding `main`.

## What ships
Student-first home and navigation, signed-in study home (Continue studying, What to study next, Recent lectures, My
courses), courses with exam dates and an exam plan, flashcard spaced review, the Help page and site footer, Settings
(Account / Plan & billing / Preferences / Privacy), the circular theme switch, student landing pages, Pricing with
monthly and yearly prices, the four-tier plan catalogue, Focused Review and across-recordings (plan-gated), study
engine 3, legal pages.

**Payments stay off in Production** until the live-payment steps are done: Production has no `STRIPE_SECRET_KEY`, no
`BILLING_PAYMENTS_ENABLED` and no `VITE_PAID_PLANS`, so Pricing shows "Coming soon" and `/api/billing` refuses checkout
before any Stripe call. Metering and quota enforcement are off in the database (`billing_settings`).

## Database
Nothing to apply. Every migration on the branch is already in production and additive (latest: course_exams,
yearly_billing, applied 2026-10-17). The code that runs in Production today ignores the new columns.

## Steps
1. ~~Owner decisions in docs/launch/04 and 05~~ done 2026-10-17; `node scripts/build-legal.mjs --final` committed.
2. Fast-forward `main` to `student/v2` (`main` is an ancestor: no merge commit) and push; Vercel builds Production.
3. Post-deploy checks (read-only, www.spark-scribe.com): `/` signed out (student hero, Pricing preview, footer),
   `/pricing` and `/pricing?billing=year` ("Coming soon", prices from the database), `/privacy` and `/terms` (final,
   effective date), `/help`, `/lecture-notes`, `/flashcards`, `/exam-prep`, `/auth?mode=signup` (age + Terms tick,
   Turnstile), desktop and phone widths; then a signed-in check by the owner: home dashboard, Library, a transcript,
   Settings.
4. Google OAuth brand verification can now use the published Privacy Policy (docs/auth/GOOGLE-BRANDING.md).
5. Real payments: docs/launch/25-live-payments.md.

## Rollback
- Vercel → Deployments → the previous Production deployment → **Instant Rollback**. Current Production before this
  release: `sparkscribe-a323queji-moerizz.vercel.app` (main 50d49a5).
- No database rollback is needed (additive changes; the old site ignores them). If ever required, tested rollback
  files are in `supabase/proposed/rollback/` (course_exams, yearly_billing).

## Live payments (separate, later)
Needs: Stripe live account ready, a restricted live key and the live webhook (created with `scripts/stripe-setup.mjs`
run by the owner with the live key, which also creates the yearly prices), the live price IDs and portal ID in Vercel
Production, `BILLING_PAYMENTS_ENABLED=1`, `VITE_PAID_PLANS=1`, and `BILLING_LIVE_APPROVED=1` only with explicit final
approval; then metering/enforcement switched on in `billing_settings`, and one controlled live purchase + refund.
