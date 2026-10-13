# Authentication email delivery — diagnosis and production setup

Status: **prepared, needs your accounts.** Nothing has been changed in Supabase, DNS or any email provider.

## 1. What prevents external users from receiving emails

Facts checked read-only on 2026-10-12:

- **Sign-up requires email confirmation** (`mailer_autoconfirm: false`). Sign-up is open, and email/password is the only
  provider. Every new user therefore needs the confirmation email before they can sign in.
- **Password reset is email-only:** `resetPasswordForEmail`, then a link to `/auth/callback`, then `/auth?mode=update`.
- **No custom domain exists.** The Vercel account has 0 domains, and production runs on `sparkscribe-moerizz.vercel.app`.
  No email-provider credentials exist anywhere in the project or its environment variables. So the project is almost
  certainly using **Supabase's built-in email sender**.
- **Supabase's built-in sender** (official docs, "Send emails with custom SMTP"):
  - It **only delivers to members of your Supabase organization**. Every other address fails with
    `Email address not authorized`.
  - It is limited to a few messages per hour, has no delivery guarantee, and is "not meant for production use".
- **Production evidence:** 1 of the 3 accounts was sent a confirmation email and never confirmed. No password reset has
  ever been requested. Logs only go back 24 hours, so earlier send errors can't be read.

**Conclusion:** with the built-in sender, a member of the public can create an account but never receives the
confirmation email, so they can never sign in. Password resets fail the same way.

**[CONFIRM]** In the Supabase dashboard → Authentication → Emails → SMTP Settings, check whether "Enable custom SMTP"
is off. That is the one fact that can't be read from outside.

Already done in the app (QA branch, commit 42744d7):
- After sign-up, and when sign-in says "email not confirmed", the page offers **Send the link again**
  (`supabase.auth.resend`).
- If the email service refuses or fails, the user sees "We couldn't send the email just now… contact support" instead of
  a raw error.

## 2. Recommended setup

| Item | Recommendation | Why | Cost |
|---|---|---|---|
| Domain | Buy one (for example `sparkscribe.app`, or `.com` if available) | SPF/DKIM need a domain you control, and a branded From address helps deliverability | about $10–40 a year **[CONFIRM name and registrar]** |
| Email provider | **Resend** | Documented Supabase SMTP integration; simple DNS; free tier covers launch | Free: 3,000 emails/month, 100/day. Pro: $20/month for 50,000 **[CONFIRM current pricing]** |
| Alternative | Postmark (strong deliverability, $15/month for 10k) or AWS SES ($0.10 per 1,000, more setup) | standby provider | — |
| Sending address | `no-reply@auth.<domain>` (a subdomain just for auth mail) | keeps auth reputation separate from any future marketing | — |
| App domain (optional) | Point `<domain>` at the Vercel project | emails and site share one brand; fewer spam flags | included with the domain |

## 3. Exact steps (you, in your accounts)

1. **Domain:** buy it (Vercel → Domains, Cloudflare or Namecheap). If you want the app on it, add it in Vercel → Project
   → Domains.
2. **Resend:** create an account → Domains → Add `auth.<domain>` → choose the region (us-east-1, to sit near Supabase).
3. **DNS:** add the records Resend shows. Copy the values exactly from Resend; they look like this:

   | Type | Name | Value | Purpose |
   |---|---|---|---|
   | MX | `send.auth` | `feedback-smtp.us-east-1.amazonses.com` (priority 10) | bounce handling |
   | TXT | `send.auth` | `v=spf1 include:amazonses.com ~all` | SPF |
   | TXT | `resend._domainkey.auth` | `p=MIGfMA0…` (long key from Resend) | DKIM |
   | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@<domain>` | DMARC: start at `none`, move to `quarantine` after 2–4 clean weeks |

   Wait until Resend shows **Verified**.
4. **API key:** Resend → API Keys → create one with **sending access only**, restricted to `auth.<domain>`. Keep it in
   Resend and Supabase only. Never paste it into chat or the repo.
5. **Supabase → Authentication → Emails → SMTP Settings:** enable custom SMTP with:
   - Host `smtp.resend.com`
   - Port `465`
   - Username `resend`
   - Password: the API key
   - Sender email `no-reply@auth.<domain>`
   - Sender name `SparkScribe`
6. **Supabase → Authentication → Rate Limits:** custom SMTP starts at 30 emails per hour. Raise it to about 100 per hour
   for launch, within Resend's 100 per day on the free tier.
7. **Supabase → Authentication → URL Configuration:**
   - Site URL = your production URL.
   - Redirect URLs must include `https://<production host>/auth/callback` and, for Preview testing,
     `https://sparkscribe-git-*-moerizz.vercel.app/auth/callback`.
   - If you move to the new domain, add it **before** switching.
8. **Templates:** paste the templates below into Supabase → Authentication → Emails → Templates. Keep them short, with no
   marketing (spam filters penalise AI-related promotional text).

## 4. Email templates (plain, no marketing)

**Confirm signup** — subject `Confirm your SparkScribe account`
```
Hi,

Confirm your email address to finish creating your SparkScribe account:

{{ .ConfirmationURL }}

Open the link in the same browser you signed up in. If you didn't create an account, you can ignore this email.
```

**Reset password** — subject `Reset your SparkScribe password`
```
Hi,

Use this link to choose a new password:

{{ .ConfirmationURL }}

Open it in the same browser you asked from. If you didn't ask for this, ignore this email; your password stays the same.
```

**Change email address** — subject `Confirm your new email address`
```
Hi,

Confirm that you want to use this address for your SparkScribe account:

{{ .ConfirmationURL }}

If you didn't ask for this, ignore this email.
```
(The app doesn't send magic links or invites, so those templates aren't used.)

## 5. Verification (about 15 minutes, before launch)

1. On the Preview, sign up with an address that is **not** in your Supabase organization (for example a fresh Gmail).
   The email should arrive within about a minute.
2. In Gmail → "Show original", check that SPF, DKIM and DMARC all say **PASS** and the mail isn't in spam.
3. Open the link in the same browser: you land signed in.
4. Use "Send the link again" once and confirm the second email arrives.
5. Forgot password → the email arrives → set a new password → sign in with it.
6. Resend → Logs shows each message as `delivered`.

## 6. Failure behaviour and fallback

| Situation | What users see | What you do |
|---|---|---|
| Email slow or in spam | "Check … (and spam)" plus **Send the link again** | nothing |
| Provider refuses or fails | "We couldn't send the email just now… contact support" | check Resend status and logs; Supabase → Logs → Auth |
| Provider outage over 1 hour | same | switch the Supabase SMTP settings to the standby (Postmark; verify its domain in advance) |
| Sign-up bots hurting reputation | — | turn on Supabase CAPTCHA (Turnstile); needs a small app change (post-launch) |
| Do **not** | — | disable email confirmation to "fix" delivery: it lets anyone register someone else's address |

Monthly cost at launch: about $1 (the domain) while under 3,000 emails a month.
