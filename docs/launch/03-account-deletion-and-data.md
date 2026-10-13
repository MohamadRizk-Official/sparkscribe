# Account deletion, personal-data inventory and retention

Status: **ready to apply.** It needs `supabase/proposed/20261012110000_account_deletion.sql` plus
`VITE_ACCOUNT_DELETION=1`. Tested only on isolated databases. No production account was touched.

## 1. Readiness

| Check | Result | Evidence |
|---|---|---|
| Identity | The dialog asks for the password and re-signs in. The database requires a real sign-in (password, OTP, OAuth…) within 10 minutes. A token refresh or sign-up entry doesn't count. Typing `DELETE` is required. | SQL 22, browser 5 |
| Other users | The user id comes only from the token (`auth.uid()`); there is no parameter. Other users' data stays byte-identical. Anonymous visitors are denied. | SQL |
| All personal records | One transaction deletes the account. Every table below marked "deleted" cascades, with no orphans (checked against the production foreign-key map, read-only). | SQL |
| Session invalidation | Supabase's sessions and refresh tokens are deleted, so other devices can't refresh. An issued access token stays valid until it expires (Supabase default: 1 hour **[CONFIRM JWT expiry in Auth settings]**). During that window, reads return nothing (rows are gone), writes fail (foreign key), and the AI endpoints check the user with the Auth server first. | SQL; Supabase docs |
| Active subscriptions | Refused while a paid plan would keep charging, unless it's set to end at the period end. No production subscriptions exist; billing is paused. | SQL |
| Accounting records | `billing_events` is kept (Stripe event log, pseudonymous id). `private.account_deletions` keeps the user id and Stripe customer id so a future job can delete the Stripe customer. | SQL |
| Storage | 0 buckets and 0 objects. (Supabase refuses to delete a user who owns Storage files: delete those first if Storage is ever added.) | read-only check |
| Browser | On success, the browser forgets the parked transcript, preferences (including custom vocabulary), AI consent and checklist state, and signs out. Theme and the downloaded speech models stay (not personal). | browser |
| Flag vs migration order | Flag on without the migration: "Deleting accounts isn't switched on yet. Nothing was deleted." Migration without the flag: the button is hidden and the function is unused. **Both orders are safe;** apply the migration first. | browser (new test) |
| Backups | Free plan: **no backups exist**, so deletion is immediate and final. Pro: daily backups keep deleted data for up to 7 days until they rotate out. | Supabase docs |
| Rollback | A tested down-migration drops the function and keeps the Stripe clean-up queue. | `qa/sql/rollback.test.mjs` |

## 2. Personal-data inventory (what exists, where, and what deletion does)

| Data | Where | On account deletion |
|---|---|---|
| Email, password hash, sign-up and last sign-in times | Supabase Auth (`auth.users`) | deleted |
| Sessions, refresh tokens (may include IP address and browser user agent) | Supabase Auth | deleted |
| Display name / avatar | `profiles` | deleted |
| Saved transcripts: title, text, speaker names, timestamps, duration, language, type; folders, favourites, last opened | `transcriptions`, `folders`, `folder_items` | deleted |
| AI results: summaries, notes, insights, Create outputs (quizzes, study guides, drafts…), quiz progress, Ask questions and answers | `transcription_insights`, `transcription_artifacts`, `transcription_questions` | deleted |
| Usage records: seconds transcribed per recording; AI actions with tokens and cost | `usage`, `ai_usage` | deleted |
| Subscription status (none today) | `subscriptions` | deleted |
| Stripe event log (none today) | `billing_events` | **kept** (accounting) |
| Deletion record (user id, time, Stripe customer id) | `private.account_deletions` | **kept** (to finish Stripe clean-up) |
| Auth and API logs (email, IP, user agent) | Supabase logs | expire: 1 day on Free, 7 on Pro **[CONFIRM]** |
| Request logs (IP, path); AI usage log lines (user id, recording id, token counts; **no content**) | Vercel logs | expire by Vercel plan retention **[CONFIRM plan]** |
| Transcript text sent to the AI | Anthropic (API) | per Anthropic's API retention **[CONFIRM current terms]** |
| Audio | **never leaves the device** | — |
| Unsaved transcript parked for sign-in (≤ 1 hour), preferences, consent | the user's browser | cleared on sign-out and deletion |
| Speech models (not personal) | the user's browser (Cache Storage) | kept |
| IP address seen by Google Fonts, Hugging Face (speech models), jsDelivr (speech runtime), Vercel, Supabase | those providers | their own retention |

## 3. User-facing disclosure (draft text)

> **Deleting your account.** You can delete your account at any time in Settings → Account → Delete account. You'll be
> asked for your password. Deletion is immediate and permanent: your saved transcripts, everything created from them,
> your folders, preferences and sign-in are removed from our systems straight away, and we can't restore them.
> Exported files you saved on your own devices aren't affected. If you have a paid plan, cancel it first.
>
> **What we keep.** If you ever had a paid plan, we keep payment records our payment processor sends us (with a
> pseudonymous account identifier, never your recordings) for as long as tax and accounting rules require.
> **[LEGAL REVIEW: retention period by jurisdiction.]** Our providers' operational logs (which can include your email
> address and IP address) expire on their own within [1–7 days] **[CONFIRM]**. Text sent to our AI provider is handled
> under its data-retention terms (see "AI processing").
>
> **Backups.** [Free plan: We don't keep database backups, so deleted data can't be recovered by anyone.]
> [Pro plan: Daily backups may contain deleted data for up to 7 days, after which it's gone.] **[CONFIRM plan]**
