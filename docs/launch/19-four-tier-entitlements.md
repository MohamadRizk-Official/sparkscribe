# Master Phase 3: four plans, entitlements and saved Thunder history

Branch `release/four-tier`: prelaunch/dev, then pricing/four-tier (Phase 1), then feature/study-intelligence (Phase 2), then this phase.

The database migration is applied to the shared Supabase project as **stage 1 only**. That stage is additive, and the live site is unaffected. The stage 2 cutover waits for the release.

## 1. Plan catalogue: one source of truth

`public.billing_plans` holds everything the app shows and enforces. The pricing page, the Account page, server entitlements, quota and AI limits all read these rows. JavaScript keeps no prices; `tests/pricing-catalog-test.mjs` reads the migration file to prove it.

| key | tier | price | intro | monthly seconds | capabilities | public (`active`) |
|---|---|---|---|---|---|---|
| free | 0 | $0 | – | 1,800 (30 min) | – | yes |
| flash | 1 | $5.99 | $1.00 for 1 month | 10,800 (3 h) | – | **after cutover** |
| bolt | 2 | $9.99 | – | 32,400 (9 h) | focused_review, followup_practice | **after cutover** |
| thunder | 3 | $14.99 | – | 72,000 (20 h) | + across_ask, across_guide | **after cutover** |
| plus / pro | – (retired) | $7.99 / $14.99 | – | 72,000 / 180,000 | – | yes until cutover, then no |

- **Tier.** It orders the lineup. Higher-tier plans include every capability of lower ones; a constraint trigger refuses any change that breaks this.
- **Retired plans.** Plus and Pro have no tier, so the new site never offers them. They stay as rows because subscriptions, usage and the FK reference plan keys. No subscription uses them today.
- **Stripe Price IDs.** These stay in server environment variables (`STRIPE_FLASH_PRICE_ID`, `STRIPE_BOLT_PRICE_ID`, `STRIPE_THUNDER_PRICE_ID`) because they differ between test and live. Phase 4 maps them.
- **Introductory price.** `intro_price_cents` is display data. The $1 charge itself is the server's and Stripe's job (Phase 4), with eligibility decided by the server.

### Free: 60 to 30 minutes

These checks were made against the production database on 2026-10-16:

- 3 accounts, 0 subscription rows, 0 live billing events, so there are no paying customers.
- 18 usage rows exist, but `metering_starts_at` is null, so none of them count.
- After the migration, all of these are byte-for-byte identical: recordings, insights, artifacts (including quiz progress), questions and usage. This was checked by row counts and md5 fingerprints taken before and after.

When the new allowance takes effect:

- It is visible now: the Account and pricing pages on Previews say 30 minutes.
- It is enforced only from the launch cutover, when `metering_starts_at` and `enforce_quota` are set.
- Recordings saved before the cutover are never counted.

Exact seconds are enforced by the existing database trigger. `qa/sql/billing.test.mjs` checks this: with 1,400 s used, a 600 s save is refused and a 300 s save leaves exactly 100 s.

## 2. Entitlements: decided by the server

### How it is decided

- `billing_status()` (database, SECURITY DEFINER, as the signed-in user) now also returns `tier` and `features`. They are computed from `private.entitlement()`, which reads the subscription that Stripe reported. A user can't write their subscription row.
- `server/entitlements.js` `requireCapability(db, cap)` reads that status before anything else.
  - **Refused:** `403 plan_required` with `details.plan` (the lowest plan that includes the capability). No recording is read, no AI is reserved, nothing is charged.
  - **Status unreadable:** `503 plan_unavailable`. It fails closed and is never treated as entitled.
- Request bodies are never consulted for the plan. A client sending `plan: "thunder"` changes nothing; the field isn't read.

### Where it is checked

| Capability | Where it is enforced | Free | Flash | Bolt | Thunder |
|---|---|---|---|---|---|
| Core transcription, Summary, Notes, Ask, flashcards, quizzes (difficulty, exam focus, per-question review, retakes), study guides, Create, exports | not gated | ✓ | ✓ | ✓ | ✓ |
| Focused Review (concept review) | UI (it reads the user's own stored quiz map; no paid data or AI) | – | – | ✓ | ✓ |
| New practice questions (`/api/tools` `followups`) | server (`generateFollowups`) | – | – | ✓ | ✓ |
| Ask across recordings (`/api/across` `ask`) | server (`askAcrossRecordings`) | – | – | – | ✓ |
| Combined study guide (`/api/across` `guide`) | server (`guideAcrossRecordings`) | – | – | – | ✓ |
| Reading and deleting saved answers and guides | not gated (ownership only) | ✓ | ✓ | ✓ | ✓ |

Focused Review's review screens reuse the concept map that every new-style quiz already stores for the user (made on any plan). Nothing paid-only is sent to the browser. What costs money, new questions, is checked on the server.

### State by subscription status

Each row is a test in `qa/sql/four-tier.test.mjs`.

| Stripe state | Plan used |
|---|---|
| active, trialing | the subscribed plan |
| past_due (Stripe retrying) | the subscribed plan, with a payment warning on the Account page |
| active with `cancel_at_period_end` | the subscribed plan until the period ends |
| unpaid, canceled, incomplete, incomplete_expired, paused | Free immediately |
| period ended more than 2 days ago without a renewal webhook | Free |
| unknown Stripe price | Free; the price is stored but grants nothing |
| test-mode subscription while the site runs live | Free |

### Upgrades, downgrades and saved work

- Plan changes take effect when Stripe's webhook stores the new subscription. Entitlements follow automatically, since they are computed from it on every request.
- **Downgrade timing.** Immediate or at period end is a Phase 4 decision, and it doesn't change this logic.
- **Nothing is deleted on a downgrade:**
  - Recordings, quizzes, review progress and follow-up questions stay. Follow-up questions remain part of the quiz and keep working in retakes.
  - Saved Thunder answers and guides stay readable and deletable on every plan.
  - Creating new Focused Review practice, new cross-recording answers or new combined guides needs the plan again.

## 3. AI fair-use limits

Limits are per billing period, in model cost, enforced by `ai_reserve` once `enforce_ai_limits` is on at launch.

| Plan | Actions / hour | Budget / period | Share of price | Estimated heavy use | Estimated normal use |
|---|---|---|---|---|---|
| Free | 20 | $0.15 | – | $0.04 | $0.01 |
| Flash | 60 | $0.75 | 12.5% (75% in the $1 month) | $0.20 | $0.05 |
| Bolt | 120 | $1.50 | 15% | $0.65 | $0.12 |
| Thunder | 240 | $3.00 | 20% | $1.50 | $0.30 |

**How heavy use is estimated.** It assumes every AI tool is used on every hour of the allowance, including regenerations:

- about $0.07 per recorded hour (from measured Haiku 5.5 costs, docs/launch/02 and 18);
- plus follow-up questions for Bolt;
- plus about 100 cross-recording questions and about 10 combined guides for Thunder.

**Headroom.** Each budget is at least 2× the heavy-use estimate, so a real student never hits it. It also caps a scripted abuser at the budget: for Thunder, $3.00, still under the price after Stripe's fee.

**The $1 Flash month.** In the worst case the AI cost is $0.75, against $1 less the Stripe fee, a loss of about $0.08 per maxed-out first month. Typical use is about $0.05.

**A plan without a limits row** gets the Free limits, never unlimited. This is tested.

The always-on ceiling (1,000 actions per user per hour) and the service-wide $5/day breaker are unchanged.

## 4. Saved Thunder history (account-wide, any device)

### Table and writes

- **Table.** `public.across_items` holds one row per answer or guide: `request_id`, `kind`, `set_key` (sorted ids), `recording_ids` (2–12), the question, `content` (≤ 64 KB) and `sources` (a per-recording snapshot, ≤ 16 KB).
  - No audio and no transcript copies are stored, only the answer itself.
  - Indexes are on `(user_id, set_key, created_at)` and `(user_id, created_at)`.
- **Writes.** Only the server writes, through `across_save(p_secret, …)`:
  - The user is `auth.uid()`.
  - Every recording must be the caller's own, and the source snapshot must name exactly those recordings.
  - It is idempotent per `request_id`.
  - It is capped at **500 items per account**. Beyond that the save is refused with a reason and nothing is deleted automatically. This is a product choice to confirm.
- **Users** can read and delete their own rows only (RLS). They can't insert or update; there are no grants for that.
- **Account deletion** removes the user's rows (on delete cascade).

### Stable names

- The model writes `{{R2}}` for a recording and `{{R2.S1}}` for a speaker, the speaker code being scoped to its recording and numbered from the speaker's original label.
- Citations stay `[R2:45]`.
- When an answer is shown, `server/ai/across.js` `resolveItem` replaces tokens with the current title and the name that speaker's lines carry now.
  - Renaming a recording or a speaker updates saved answers without regenerating them.
  - "Speaker 1" of two different recordings is never conflated.
  - Nothing is found by searching text for names.

### Deleted and edited recordings

- **Deleted:** the source is shown as unavailable (no link) with the title it had, and the rows are kept.
- **Edited** (words or who-said-what changed, judged by a transcript fingerprint): the item is flagged as possibly out of date and never presented as re-verified.
- **Renamed only:** nothing is flagged.

### Sync

- The page always shows the server's copy and reloads it when the tab regains focus, comes back online, or becomes visible.
- Another device's new answer appears, and a deletion disappears.
- A failed save still shows the answer, marked "not saved".
- Older builds' browser-only copies are cleared at sign-out.

## 5. Migration and cutover

- **Stage 1** (`supabase/migrations/20261016100000_four_tier.sql`, applied 2026-10-16) is additive:
  - plan columns;
  - the new plan rows with `active = false`;
  - Free set to 1,800 s;
  - AI limits;
  - `billing_status` with features;
  - `across_items` and `across_save`.
  - It is safe because production (`main`) reads no billing table, and metering and enforcement are off.
- **Stage 2** (`supabase/proposed/20261016110000_four_tier_cutover.sql`): one `update` of the `active` flags (Free/Flash/Bolt/Thunder public, Plus/Pro retired). It runs together with deploying the new site, which itself lists plans by tier and doesn't depend on the flag.
- **Rollback:** `supabase/proposed/rollback/20261016100000_four_tier.down.sql`. It refuses if a subscription uses a new plan, and it deletes saved Thunder history.
- **Release order (Phase 5):**
  1. deploy the new site;
  2. run stage 2;
  3. set `metering_starts_at = now()`, `enforce_quota = true` and `enforce_ai_limits = true`;
  4. switch Stripe live after approval (Phase 4/5).

## 6. Tests

| Suite | Checks |
|---|---|
| `qa/sql/four-tier.test.mjs` (real migrations, PGlite) | 54: data preserved; catalogue; capability by subscription state; AI limits and fallback; history RLS (guessed ids, anon, insert/update refused), forged sources, idempotency, 500 cap, size cap, cascade; cutover; rollback and re-apply |
| `qa/sql/billing.test.mjs`, `billing-server.test.mjs` | 43, 46 (updated to the four tiers; Free 1,800 s enforcement) |
| `tests/across-test.mjs` | 34: Thunder-only gate per plan, refused before reading, plan unreadable leads to 503 |
| `tests/across-history-test.mjs` | 29: tokens stored; current titles and speakers; per-recording speakers; edited and deleted recordings; retry; failed save; downgrade keeps history |
| `tests/followups-test.mjs` | Bolt-only gate (Free and Flash refused, no AI) |
| `tests/pricing-catalog-test.mjs` | 18: page prices come from the migration's rows; no preview switch left |
| Browser (harness) | across 19 (Free gate, server history, cross-device sync, rename, deletion); Focused Review 9 (Flash gate and upsell, Bolt flow); pricing 3; Account ×4 plans; home quota 4; study 7, create 5, insights 3, library 7 |
