# student/v2 QA run (2026-10-17)

Branch `student/v2` at the commits of 2026-10-17 (yearly billing, legal drafts). Harness = `qa/harness/dev-mock.mjs`
(offline: mock Supabase in the browser, the real server code with a mock AI). Every suite was run as its header says
(fresh harness where required).

| Area | Suite | Result |
|---|---|---|
| Unit | `npm test` (16 files) | all pass |
| Database (PGlite, every migration) | `npm run test:sql` (14 files, incl. course-exams 24, yearly-billing 26) | all pass |
| Billing server (fake Stripe) | billing-server.test.mjs | 73/73 |
| Billing, real Stripe TEST mode | stripe-real.test.mjs | 41/41 (incl. yearly 21–23) |
| Spaced review | srs.e2e.js | 7/7 + home 1/1 |
| Exam prep | exam.e2e.js | 7/7 |
| Yearly UI (paid-plans harness) | yearly.e2e.js | 9/9 |
| Billing UI, payments off | billing.e2e.js pricing/account/home | 3/3, 1/1, 4/4 |
| Study engine / Create | study.e2e.js, create.e2e.js | 7/7, 5/5 |
| Focused Review | focus-review.e2e.js run/run2 | 3/3, 4/4 |
| Across recordings | across.e2e.js (7 stages) | 19/19 |
| Library | library.e2e.js | 7/7 |
| Transcript page | transcript, insights, export-ui | 8/8, 3/3, 4/4 |
| Home save | home-save.e2e.js | 8/8 |
| AI limits | ai-limits.e2e.js | 5/5 |
| Settings | appearance, account-deletion | 5/5, 5/5 |
| Auth | auth.e2e.js run/consent | 13/13, 3/3 |
| Password reset | recovery.e2e.js | 22/22 |
| CAPTCHA | captcha.e2e.js run (captcha-harness) / off | 16/16, 2/2 |
| Shared-computer privacy | pending-privacy.e2e.js | 7/7 |
| Security, save retry | security, save-retry | 4/4, 2/2 |
| Legal + footer | legal.e2e.js (updated for the site footer and current drafts) | 2/2 |
| Accessibility | a11y.e2e.js; axe scan (WCAG 2.1 A/AA, serious+critical) light and dark, incl. /help, yearly pricing, settings | 4/4; 0 violations |
| Phone layout (375 px) | layout.e2e.js over 10 pages | no overflow |

Not run here: `inputs.e2e.js` (needs a production build + static server for the FFmpeg cases) and `model-cache.e2e.js`
(unchanged code). Notes: suites that mutate the harness store must start from a fresh harness, and the fixture helper
must run after a reload that follows clearing sessionStorage (it writes back the page's in-memory database).

## Release checks (2026-10-17, af3fb8f)
- Legal: `build-legal --final` (no notes), `tests/legal-guard-test.mjs` 7/7 (a draft stops a production build; the
  final pages build), `REQUIRE_FINAL_LEGAL=1` build passes, legal.e2e 2/2 (final pages, footer, sign-up tick).
- Billing: billing-server 76/76 (checkout renewal text, optional Terms consent), real Stripe test mode 41/41 on the final
  code, `scripts/billing-check.mjs` all ✓ on the test configuration.
- Production deployment `sparkscribe-3tayxn24r` (main af3fb8f), www.spark-scribe.com:
  every public page 200 (/, /pricing, /pricing?billing=year, /privacy, /terms, /help, /lecture-notes, /flashcards,
  /exam-prep, /auth, /library, /settings, /account, sitemap, robots); Terms/Privacy final (effective October 17, 2026,
  no draft markers); Pricing shows Free + Flash/Bolt/Thunder monthly and yearly ($59/$99/$149) from the database with
  "Coming soon"; sign-up shows the age/Terms tick and Cloudflare Turnstile; theme switch works; no console errors;
  phone-width (375 px) home, pricing and sign-up render correctly; `/api/billing` and `/api/insights` refuse unsigned
  calls (401), `/api/stripe-webhook` refuses GET (405).
- Not verifiable without an account sign-in (done in the harness on the same code): signed-in dashboard, Library,
  courses/exam prep, study tools, spaced review, Settings. Owner smoke test recommended.
- Rollback: previous production deployment `sparkscribe-a323queji` (main 50d49a5) is Ready and serving; Vercel Instant
  Rollback restores it. Database changes are additive (no rollback needed).

## Billing release 654557f (2026-10-17)
Two-key live setup with probed permissions, the pilot allowlist, webhook reuse. billing-server 80/80, unit and SQL
suites pass, production build (`REQUIRE_FINAL_LEGAL=1`) passes, `stripe-live-setup.mjs --dry-run` passes in test mode.
Payments remain off in Production (no Stripe variables; billing_settings all off). Rollback: `sparkscribe-3tayxn24r`.
