# Support, incident and recovery procedures

## 1. Support contact
- **Address:** `support@<domain>` (forward to your inbox once the domain exists). Use it in the Privacy Policy, the Terms,
  the "couldn't send the email" message and the app footer. **[CONFIRM address and who answers]**
- **Target response:** within 2 business days; privacy requests (access, export, deletion help) within 30 days.
  **[CONFIRM]**
- **Common requests:**

| Request | How |
|---|---|
| Didn't get the confirmation or reset email | Ask them to check spam and use "Send the link again". Check Resend → Logs for the address (delivered / bounced). Check Supabase → Logs → Auth. Never mark a user confirmed by hand without verifying they own the address. |
| "My AI limit is reached" | Explain the hourly/monthly limits. Adjust a plan's limits globally with an UPDATE; don't make per-user exceptions in the database by hand. |
| Delete my account (can't sign in) | Verify ownership by email reply from the account address, then delete via Supabase → Authentication → Users → Delete user (same cascade as self-service). Log the date. |
| Export all my data | In-app exports cover each transcript; for a full export, run a scoped query for that user id and send it securely. |
| Bug report | Collect browser, device, time and what they did; never ask for their password or recordings. |

## 2. Incident levels

| Level | Examples | First action |
|---|---|---|
| **SEV1** | data exposed to the wrong user; leaked secret; site down | act immediately (below) |
| **SEV2** | sign-up/reset emails failing; AI unavailable; AI spend spike | within hours |
| **SEV3** | a single feature broken; cosmetic | next working day |

## 3. Playbooks

**Site broken after a deploy:** Vercel → Deployments → previous production deployment → **Instant Rollback**. The
database changes in this release only add things, so the older code keeps working. Investigate on a Preview.

**AI spend spike or abuse:**
1. Pause all AI at once: `update public.billing_settings set ai_daily_budget_microusd = 1;`
2. Find the cause: `select user_id, count(*), sum(coalesce(cost_microusd, estimate_microusd)) from public.ai_usage where
   created_at > now() - interval '24 hours' group by 1 order by 3 desc limit 20;`
3. Lower the limits (`update public.ai_plan_limits …`) or ban the account (Supabase → Users → Ban).
4. Restore the breaker: `… set ai_daily_budget_microusd = 5000000`.

The Anthropic Console spend limit is the final backstop.

**AI unavailable (users see "briefly unavailable"):**
- Check Vercel function logs for `[ai-usage] reserve failed` and Supabase status.
- If the ledger itself is broken and can't be fixed quickly, set `AI_LIMITS_DISABLED=1` in Vercel and redeploy (checks
  off, logged), fix, then remove it.
- If Anthropic is down, users see "couldn't be generated"; nothing to do but wait (status.anthropic.com).

**Auth emails failing:** check Resend status and logs, then Supabase SMTP settings. If the provider is down for more than
1 hour, switch the Supabase SMTP settings to the standby provider. Don't disable email confirmation.

**Leaked secret:**
- `ANTHROPIC_API_KEY`: revoke in the Anthropic Console, create a new key, set it in Vercel, redeploy.
- `BILLING_DB_SECRET`: generate a new value, set it in Vercel (Production and Preview), then
  `update private.billing_secrets set hash = extensions.digest('<new>', 'sha256') where name = 'server';` and redeploy.
- Supabase keys: rotate in Supabase → Settings → API (the publishable key is public by design).
- Resend key: revoke and replace in Supabase SMTP settings.

**Data exposed to the wrong user (SEV1):**
1. Roll back the deploy.
2. Run the Supabase security advisor.
3. Identify the affected rows and users from logs.
4. Keep evidence.
5. **[LEGAL REVIEW]** Notification duties (e.g. GDPR: 72 hours to the authority; US state laws) and notify affected users.

**Database loss or corruption:**
- Free plan: restore only from your own dump (below).
- Pro plan: Dashboard → Database → Backups → restore (up to 7 days; the project is offline during the restore).

**Project paused (Free plan, inactive for 7 days):** Dashboard → Resume (possible for 90 days). Avoid it entirely on Pro.

## 4. Backups you run yourself (needed on the Free plan, useful on any plan)

```bash
npx supabase login
```

```bash
npx supabase db dump --linked -f backup-schema.sql
```

```bash
npx supabase db dump --linked --data-only -f backup-data.sql
```

- Run them before every migration and at least weekly. Store the files encrypted, off your laptop (for example in an
  encrypted cloud drive).
- The dumps contain user data: they're covered by the Privacy Policy and must be deleted on schedule (for example keep 4
  weekly copies). A deleted account still exists in older dumps until they're removed; say so if you keep dumps.
  **[LEGAL REVIEW]**
