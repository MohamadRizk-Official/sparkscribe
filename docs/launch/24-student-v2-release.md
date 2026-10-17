# student/v2 → Production: release runbook

**Status (2026-10-17):** ready on Preview (`https://sparkscribe-git-student-v2-moerizz.vercel.app`), all suites green
(docs/launch/23-student-v2-qa.md). **One gate left: owner approval of the Privacy Policy and Terms.** Production has no
legal pages today, and the student-first site links to them (footer, sign-up consent), so the production build refuses
drafts by design (`legal-final-guard` in vite.config.js).

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
1. Owner decisions in docs/launch/04 and 05 (the remaining **[CONFIRM]** notes: effective date, optional postal address,
   yearly renewal reminders, refunds for unused yearly months, 30-day price-change notice, liability cap).
2. Edit the drafts accordingly, then `node scripts/build-legal.mjs --final` (refuses while any note remains) and commit.
3. Turn on Stripe's renewal reminder emails for yearly plans (if that is the chosen answer in step 1).
4. Fast-forward `main` to `student/v2` (`main` is an ancestor: no merge commit) and push; Vercel builds Production.
5. Post-deploy checks (read-only, Production URL and www.spark-scribe.com): `/` signed out (student hero, Pricing
   preview, footer), `/pricing` and `/pricing?billing=year` ("Coming soon", prices from the database), `/privacy` and
   `/terms` (no Draft banner), `/help`, `/lecture-notes`, `/flashcards`, `/exam-prep`, `/auth?mode=signup` (age +
   Terms tick, Turnstile), then a signed-in check by the owner: home dashboard, Library, a transcript, Settings.
6. Google OAuth brand verification can then use the published Privacy Policy (docs/auth/GOOGLE-BRANDING.md).

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
