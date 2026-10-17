# SparkScribe: project context (read this first)

Living document for anyone (human or AI session) picking up the work. Updated 2026-10-17.

## What SparkScribe is
A **student-first** study product: a student uploads a class recording, it is transcribed **on their device**, and the
transcript becomes notes, explanations, practice questions, flashcards and a study guide. Operator: **HRstudios LLC**
(Michigan). Contact: contact.hrstudios@gmail.com. Audience: 13+ (13–17 need a parent's or guardian's permission;
paid plans are bought by an adult).

Positioning (2026-10-17 directive): we sell turning lectures into understanding, practice and exam readiness, not
transcription. Journey: lecture → transcript → notes → explanations → practice → weak-topic review → exam prep. Work
features (meeting recaps, drafts) stay working but are not the public message.

## Where things are
| | |
|---|---|
| Production | https://www.spark-scribe.com, Vercel project `sparkscribe` (team moerizz), branch `main` |
| Database/Auth | Supabase project `strkrrdndoofpcenopxk` (Free plan), shared by Preview and Production |
| Email | Resend SMTP (no-reply@spark-scribe.com), 9 branded templates, see docs/auth/EMAIL-SETUP.md |
| CAPTCHA | Cloudflare Turnstile, enforced by Supabase since 2026-10-17 05:35 UTC, see docs/auth/README.md |
| AI | Anthropic **Claude Haiku 5.5 only** (`claude-haiku-5-5`); owner forbids other models |
| Payments | Stripe; account activated for live payments (owner, 2026-10-17); all flows tested in test mode |
| Repo | github.com/MohamadRizk-Official/sparkscribe, **public**: never commit secrets, private audio or lecture text |

## Branches (2026-10-17)
- `main`: Production (50d49a5). The auth release, the newer UI, auth fixes. No billing, legal, study engine 3,
  Focused Review or Across.
- `release/four-tier` (968d96b): everything built but not yet released. Study engine 3, Create Study/Work/Specialized,
  Focused Review (Bolt), Across recordings (Thunder), four-tier billing and entitlements, AI cost limits, account
  deletion, the age/Terms consent step, draft legal pages, CSP report-only, speaker editing.
- **`student/v2`** (from release/four-tier, with main merged at 8a1627e): **the working branch for the student-first
  release.** Everything new goes here.

## Release gates (enforced in code)
- **Legal:** `vite.config.js` legal-final-guard fails a production build while /privacy or /terms contain draft
  markers. Finalize with `node scripts/build-legal.mjs --final` only after the owner approves the text.
- **Payments:** checkout needs a Stripe key, `BILLING_PAYMENTS_ENABLED=1`, and for a live key also
  `BILLING_LIVE_APPROVED=1` (server/billing/config.js). The owner approves live.
- **Metering:** the DB `billing_settings` row (metering_starts_at, enforce_quota, enforce_ai_limits) is all off until
  launch.

## Decisions (owner)
- 2026-10-17:
  - Keep the four tiers: Free 30 min, Flash $5.99/mo ($1 first month) 3 h, Bolt $9.99 9 h, Thunder $14.99 20 h.
  - Monthly **and yearly** billing.
  - Michigan governing law.
  - Stripe live account activated.
- 2026-10-16:
  - After email verification → sign out → "Email verified. Sign in".
  - Reset never signs in.
  - Age/Terms step ships with the published legal pages.
- Refunds: none except errors, service failures or where the law requires. Tax: Stripe Tax; register only where
  required.

## Feature inventory (student/v2)
Legend: ✅ functional and verified (tests and/or real use) · 🟡 implemented, not verified on real services · 🟠 partial ·
🎭 demo/illustration only · ⬜ missing.

| Feature | State | Notes |
|---|---|---|
| On-device transcription (Whisper, WebGPU/CPU), speakers | ✅ | Production since 2026-10-08; diarize.js v1 frozen |
| Save to account, Library (search, folders, favourites, recent) | ✅ | Folders exist but have 0 rows in prod: they become **Courses** |
| `last_opened_at` per recording | ✅ | Set when opened (lib/library.js markOpened): drives Continue Studying |
| Summary, Notes, Ask (grounded, timestamps) | ✅ | Haiku 5.5 |
| Create: study guide, flashcards, quiz (engine 3, section study map), exam points, definitions | 🟡 | Live in prod: engine 1/2. Engine 3 is on this branch (evaluated offline) |
| Quiz progress (`transcription_artifacts.progress`, ≤4000 B), retake missed | ✅ | |
| Focused Review (weak concepts from quiz results; Bolt+) | 🟡 | Branch only; e2e + unit tested |
| Across recordings: Ask and combined guide (Thunder) | 🟡 | Branch only; real-model tested $0.023 |
| Four-tier billing: Stripe checkout, portal, webhooks, entitlements | 🟡 | Test mode 32/32 real scenarios; not in prod |
| Yearly prices | 🟡 | $59/$99/$149 (owner 2026-10-17). DB migration yearly_billing applied (monthly allowance windows); Stripe TEST prices created; real test 41/41; live not configured |
| AI usage ledger and limits | 🟡 | DB applied; enforcement off |
| Account deletion | 🟡 | Migration applied; UI on branch |
| Legal pages (/privacy, /terms) | 🟠 | Drafts updated 2026-10-17 (Michigan, Resend, Turnstile, yearly); 6 owner decisions remain; the release gate (docs/launch/24) |
| Student landing pages (/lecture-notes, /flashcards, /exam-prep) | 🟡 | FAQ JSON-LD, sitemap |
| Student dashboard (Continue Studying, recent, courses, what's next) | 🟡 | src/home/dashboard.js; harness-verified; branch only |
| Course exam dates / study plan | 🟡 | src/home/exam.js; e2e 7/7; migration course_exams applied to prod 2026-10-17 (owner-approved, SQL test 24) |
| Flashcard spaced repetition | 🟡 | src/insights/srs.js, schedule in the set's progress (no schema change); e2e 7/7; home suggests due cards |
| Theme circle transition | 🟡 | View Transitions from the button; instant with reduced motion/unsupported; 300 ms safety fallback |
| Settings: Account, Plan & billing, Preferences, Privacy | 🟡 | Current-section nav, sidebar ≥980px, scrolling row on phones |
| Product analytics (privacy-conscious) | ⬜ | Privacy Policy currently says "no analytics" |
| Google OAuth brand verification | ⬜ | Needs the published Privacy Policy (docs/auth/GOOGLE-BRANDING.md) |
| Original audio playback across devices | ⬜ by design | Audio is kept only in the browser that recorded it (IndexedDB, opt-out in Settings) |

## Unit economics (measured 2026-10-17 from stored token counts, Haiku 5.5 $0.10/$0.50 per MTok)
- Overview $0.0008, Notes $0.0013, Quiz $0.002, Study guide $0.004, one Ask $0.0004.
- Engine-3 flashcards for a fresh full lecture ≈ $0.03.
- **A full study set for a 60–90 min lecture ≈ $0.05–0.07.**
- Transcription costs $0 (on device).
- Per-plan AI monthly budget caps (`ai_plan_limits`): free $0.15, flash $0.75, bolt $1.50, thunder $3.00.
- Fixed costs to plan for: Vercel Pro (commercial use), Supabase Pro (backups), Resend (free tier now).

## Testing
- `npm test`: unit (≈435 checks).
- Harness: `node qa/harness/dev-mock.mjs <port>` (launch configs `study-harness` 5193, `captcha-harness` 5195 with
  the Turnstile test key). Suites live in `qa/e2e/*.e2e.js`; each file's header says which page to run it on (auth
  suites from `/qa/e2e/host.html`).
- Real Stripe test runner: `qa/sql/stripe-real.test.mjs`.

## Incidents
- 2026-10-17: a crash zero-filled 244 working-tree files. They were restored from git objects (see memory note). Push
  often.
