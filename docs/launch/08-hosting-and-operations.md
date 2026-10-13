# Hosting and database arrangements

## Current state (checked 2026-10-12)

| Item | Finding | Risk |
|---|---|---|
| Supabase organization plan | **Free** (`sparkscribe-prod`, us-east-1, Postgres 17.11) | see below |
| Database size | 18.7 MB of the Free plan's 500 MB (transcriptions 6.4 MB) | low for now |
| Backups | **None on Free.** Supabase backs up only Pro and above (Pro: 7 days of daily backups; PITR is a paid add-on at about $100/month for 7 days) | **high:** a bad migration or mistake is unrecoverable without your own dump |
| Project pausing | Free projects with low activity for 7 days are paused (warning email first; restorable for 90 days). Paid plans never pause. | medium: a quiet week pauses the whole product |
| Auth emails | built-in sender: team members only, a few per hour | **blocker** (see `01-email-delivery.md`) |
| Logs retention | Free: 1 day | low; harder investigations |
| Leaked-password protection | off; it's a Pro feature | low/medium |
| Vercel account `moerizz` | plan not readable with the available access **[CONFIRM]**. The Hobby plan is for personal, non-commercial use. A business product needs **Pro** **[CONFIRM / LEGAL REVIEW]** | medium |
| Domain | none; production is on `sparkscribe-moerizz.vercel.app` | needed for email, recommended for trust |
| Preview vs production database | **The same Supabase project.** Preview deployments read and write production data. | medium: test only with disposable accounts; never run destructive tests on Previews |

## Recommendation (needs your approval: these are new costs)

| Item | Monthly | Why |
|---|---|---|
| Supabase **Pro** | $25 (includes $10 compute credit) **[CONFIRM current pricing]** | daily backups (7 days), no pausing, leaked-password protection, 7-day logs, 8 GB database |
| Vercel **Pro** | $20 per member | commercial use allowed; higher limits **[CONFIRM current plan first]** |
| Domain | about $1–3 | email deliverability, brand |
| Resend | $0 (≤ 3,000 emails a month), then $20 | auth email |
| Anthropic (AI) | about $3 per 100 active users; hard cap about $150 via the breaker | usage-based |
| **Total fixed** | **about $46–48 a month** plus AI | — |

Minimum safe alternative if you stay on Free at launch: weekly manual dumps (see `07-support-and-incident-procedures.md`),
a dump before every migration, and accepting the pause risk. Upgrade before you charge users.

## Routine operations
- **Weekly:** check AI spend (`select date_trunc('day', created_at), sum(coalesce(cost_microusd, estimate_microusd))/1e6
  from public.ai_usage group by 1 order by 1 desc limit 14;`), the security advisor, and Resend bounces.
- **Before each migration:** take a dump; apply on a Preview branch database if you're on Pro (branching), otherwise
  re-run `qa/sql` tests locally against the new SQL.
- **Monthly:** review limits against real costs; rotate the Resend key if team access changed.
