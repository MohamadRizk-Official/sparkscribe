# Database migrations at a glance

One line per file in `supabase/migrations/`, taken from the comment at the top of each file (read that comment for the
full design and the safety review). Files are applied in name order; the name starts with a 14-digit timestamp.
`tests/repo-layout-test.mjs` checks the naming and order, and that every migration from `20261012100000` on has a
rollback in `supabase/proposed/rollback/`.

| migration | what it adds |
|---|---|
| `20261007200000_phase1_accounts` | accounts and saved transcripts. Every table has row-level security; policies only match rows where `user_id` is `auth.uid()`; the browser never chooses `user_id`; `usage` and `subscriptions` are read-only for signed-in users |
| `20261008000000_phase3_insights` | transcript intelligence (summaries, insights, Ask); line-level `segments` so answers can point at real timestamps |
| `20261008120000_phase3_notes` | Notes as their own stored analysis kind, separate from the summary |
| `20261009000000_phase4_library` | My Library: favorites, folders, "recently opened" and full-text search (title weighted above transcript text) |
| `20261009010000_phase4_library_fixes` | fixes after testing: `coarse` is false (not null) without line-level segments; unnamed recording types count as General |
| `20261009020000_phase4_search_refinements` | a recording with every searched word, but never on one line, now shows a partial snippet; generic "Speaker N" labels stay out of the Notes index |
| `20261010000000_phase4_current_notes_only` | out-of-date Notes no longer take part in Library search (they stay stored and show their "out of date" banner) |
| `20261010010000_phase5_artifacts` | one table for every generated output (study guide, flashcards, quiz, recap, drafts…), keyed by recording, kind and settings, with the transcript version it was made from |
| `20261011000000_phase6_billing` | plans, Stripe subscriptions, transcription usage and quota. `billing_plans` is the single source of truth for plan names, prices and allowances; Stripe price ids stay in server environment variables |
| `20261011010000_phase6_billing_hardening` | security-advisor fixes: a pinned `search_path`, and the secret-gated `billing_*` write functions closed to signed-in users |
| `20261012100000_ai_usage_limits` | per-user AI usage limits enforced in the database (`ai_reserve` / `ai_settle`), because anything the server can write as the user, the browser could write too |
| `20261012110000_account_deletion` | self-service account deletion (`delete_my_account`); everything the user owns goes with the `auth.users` row through `ON DELETE CASCADE` |
| `20261015100000_launch_integrity` | additive launch fixes, including a retried save never duplicating a recording (the browser chooses the id once) |
| `20261016100000_four_tier` | the four plans (Free, Flash, Bolt, Thunder), their capabilities and AI limits, and saved Thunder history. Stage 1 of 2: additive, new plans inserted inactive; Free becomes 30 minutes |
| `20261017100000_flash_intro` | eligibility for, and the record of using, the Flash introductory offer, tracked per Stripe mode |
| `20261017200000_course_exams` | an exam date and expected topics on a course (a Library folder); two nullable columns, no table rewrite |
| `20261017300000_yearly_billing` | yearly prices shown on the site (what is charged is the Stripe price); the allowance still renews monthly |
| `20261027100000_unlimited_accounts` | a short, owner-kept private list of accounts that get every Thunder feature without limits. The list lives in a private schema with no grants |
| `20261027110000_study_map_kind` | the `study_map` result kind, so the study map can be built ahead of time and reused by quizzes and flashcards; it is never shown as a result |

## Rollbacks and proposals
- `supabase/proposed/rollback/<name>.down.sql` undoes the matching migration. The migration's own header names its rollback file.
- `supabase/proposed/` also holds changes that are written but **not** applied (for example the second stage of the four-tier cutover, `20261016110000_four_tier_cutover.sql`). A proposed file is never copied into `migrations/` under the same name.
- `20261017200000_course_exams` has a rollback file but its header does not mention it; every other migration from `20261012100000` on names its rollback.
- Headers that start with "Applied to production <date>" record when the owner approved and applied the file.

## One oddity
`20261017300000_yearly_billing` has an hour part of `30` in its timestamp (it reads as 17 October, 30:00:00). That is not a
real time of day, but only the order of the numbers matters, and it sorts correctly between its neighbours.
