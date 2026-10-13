# Authentication email delivery — diagnosis and exact setup

Status: **prepared; needs your accounts.** Nothing has been changed in Supabase, DNS, Microsoft 365 or any email
provider. Everything below is written for **`sparkscribe.ai` as the candidate domain, which is not yet confirmed**. If your
domain is different, replace it throughout; the templates contain no domain, and the checker takes any domain.

## 0. Confirm the domain before any DNS change (you, about 5 minutes)

What public records show for `sparkscribe.ai` (read-only, 2026-10-13):

| Source | Finding |
|---|---|
| Registry (RDAP) | registered **2025-04-29** at **GoDaddy.com, LLC**, expires **2027-04-29**; owner hidden by "Domains By Proxy" (normal GoDaddy privacy); registrar locks on |
| DNS | GoDaddy nameservers; Microsoft 365 mail (MX); a Microsoft tenant verification record `MS=ms41644051`; two Google site-verification records; DMARC `p=reject` |

Public data can't prove who owns it. To confirm:
1. Sign in to **GoDaddy** → My Products: `sparkscribe.ai` is listed under your account, with auto-renew on (it expires
   2027-04-29).
2. Microsoft 365 admin center → Settings → Domains: `sparkscribe.ai` shows as **Verified** (that's the `MS=` record).
3. Only then make the DNS changes below.

Check before and after any change (read-only; prints exactly what's missing):

    node scripts/check-email-dns.mjs sparkscribe.ai

Today it reports: Microsoft 365 SPF missing, Microsoft 365 DKIM missing, and all three Resend records missing (exit code 1).

## 1. Why external users can't receive SparkScribe's emails today

- Sign-up requires email confirmation, and password reset is email-only. Email is the only sign-in method.
- The Supabase project has no custom email sender configured. No email-provider credentials exist anywhere in the project
  or Vercel. So it uses **Supabase's built-in sender**, which (official docs) delivers **only to members of your Supabase
  organization**, at a few messages per hour, with no delivery guarantee.
- Production evidence: 1 of 3 accounts was sent a confirmation email and never confirmed; no password reset was ever
  requested.
- **[CONFIRM]** Supabase → Authentication → Emails → SMTP Settings shows "custom SMTP" **off**.

App-side fallback, already built on `prelaunch/dev`:
- After sign-up, and when sign-in says "email not confirmed", the page offers **Send the link again**.
- If the email service refuses or fails, users see a plain "couldn't send the email" message.

## 2. A problem with your existing company email (found while checking)

Public DNS for `sparkscribe.ai`, checked via Google DNS on 2026-10-13:

| Record | Found | Effect |
|---|---|---|
| MX | `sparkscribe-ai.mail.protection.outlook.com` | Microsoft 365 receives your mail ✔ |
| `_dmarc` | `v=DMARC1; p=reject; adkim=r; aspf=r; rua=…@onsecureserver.net` | receivers must **reject** mail that fails SPF/DKIM alignment |
| SPF (`v=spf1…` at the root) | **none** | Microsoft 365 isn't authorised to send for the domain |
| DKIM (`selector1/selector2._domainkey`) | **none** | Microsoft 365 signs only with its own `onmicrosoft.com` key, which doesn't align |

Result: mail sent from `@sparkscribe.ai` through Microsoft 365 probably **fails DMARC and is rejected** by Gmail, Outlook
and others. That includes support replies and anything a user sends to `support@`. Fix it before launch.

**Fix (GoDaddy DNS + Microsoft 365 admin, about 15 minutes):**
1. GoDaddy → DNS → add TXT at `@`: `v=spf1 include:spf.protection.outlook.com -all`.
   Only one SPF record may exist at the root.
2. Microsoft Defender portal → Email & collaboration → Policies → Threats → Email authentication settings → DKIM →
   `sparkscribe.ai` → it shows two CNAME records. Add them in GoDaddy:
   - `selector1._domainkey` → `selector1-sparkscribe-ai._domainkey.<your tenant>.onmicrosoft.com`
   - `selector2._domainkey` → `selector2-sparkscribe-ai._domainkey.<your tenant>.onmicrosoft.com`

   Then enable DKIM there. Copy the exact targets from the portal; the tenant part is yours.
3. Send a test from Outlook to a Gmail address → "Show original": SPF, DKIM and DMARC should each say **PASS**.

Keep the existing DMARC record; it's a good policy once SPF and DKIM pass.

## 3. Transactional email setup (recommended: Resend, on a subdomain)

Use `auth.sparkscribe.ai` only for SparkScribe's automatic emails. That keeps them separate from your Microsoft 365 mail.
Your root DMARC `p=reject` also covers the subdomain, which is fine because Resend's DKIM aligns.

| Item | Value |
|---|---|
| Provider | Resend (free: 3,000 emails/month, 100/day; Pro $20/month **[CONFIRM pricing]**) |
| Sending domain | `auth.sparkscribe.ai` |
| From | `SparkScribe <no-reply@auth.sparkscribe.ai>` |
| Reply-to (in templates or provider) | `support@sparkscribe.ai` (a Microsoft 365 mailbox or alias) **[CONFIRM address]** |
| Region | us-east-1 (next to Supabase) |

**DNS records to add in GoDaddy** (the exact values come from Resend after you add the domain; they look like this):

| Type | Host (in GoDaddy) | Value | Purpose |
|---|---|---|---|
| MX | `send.auth` | `feedback-smtp.us-east-1.amazonses.com` (priority 10) | bounces |
| TXT | `send.auth` | `v=spf1 include:amazonses.com ~all` | SPF for the bounce domain |
| TXT | `resend._domainkey.auth` | `p=MIGfMA0GCSqGSIb3…` (from Resend) | DKIM, aligned with `sparkscribe.ai` |
| — | `_dmarc` | **already exists, don't add another** | — |

These don't touch the website (no A/CNAME on `@` or `www`), so the public domain stays unpointed.

**Steps (you):**
1. Resend → Domains → Add `auth.sparkscribe.ai` (us-east-1) → add the records in GoDaddy → wait for **Verified**.
2. Resend → API Keys → "Sending access", restricted to `auth.sparkscribe.ai`. Paste it only into Supabase.
3. Supabase → Authentication → Emails → SMTP Settings → enable custom SMTP:
   - Host `smtp.resend.com`
   - Port `465`
   - User `resend`
   - Password: the API key
   - Sender `no-reply@auth.sparkscribe.ai`
   - Name `SparkScribe`
4. Supabase → Authentication → Rate Limits → emails per hour: about 60–100 (Resend free allows 100 a day).
5. Supabase → Authentication → Emails → Templates: paste `email-templates/confirm-signup.html`,
   `email-templates/reset-password.html` and `email-templates/change-email.html`.
   Subjects:
   - "Confirm your SparkScribe account"
   - "Reset your SparkScribe password"
   - "Confirm your new email address"

   Keep "Email OTP expiration" at 3600 s (the templates say 1 hour).
6. Supabase → Authentication → URL Configuration:
   - **Site URL:** `https://sparkscribe-moerizz.vercel.app` (until you point a domain at the app).
   - **Redirect URLs:**
     - `https://sparkscribe-moerizz.vercel.app/auth/callback`
     - `https://*-moerizz.vercel.app/**` (Previews)
     - `http://localhost:5173/**` (development)
     - Later: `https://sparkscribe.ai/auth/callback`.

## 4. Verification (about 15 minutes)

1. On the Preview, sign up with a Gmail address that isn't in your Supabase organization. The email arrives within about a
   minute, from `no-reply@auth.sparkscribe.ai`.
2. Gmail → "Show original": SPF **PASS**, DKIM **PASS** (`d=auth.sparkscribe.ai`), DMARC **PASS**; not in spam.
3. Open the link in the same browser: you're signed in. Use "Send the link again" once: a second email arrives.
4. Forgot password → the email arrives → choose a new password → sign in with it.
5. Resend → Logs: each message `delivered`. Optional: send one to a mail-tester.com address and aim for a 9/10 score or
   better.

## 5. Failure behaviour

| Situation | User sees | You do |
|---|---|---|
| Slow or in spam | "check spam" + **Send the link again** | — |
| Provider refuses or fails | "We couldn't send the email just now… contact support" | Resend status/logs; Supabase → Logs → Auth |
| Outage over 1 hour | same | switch Supabase SMTP to a standby provider (Postmark), verified in advance on `mail.sparkscribe.ai` |
| Sign-up bots | — | enable Supabase CAPTCHA (Turnstile); needs a small app change (post-launch) |
| Never | — | disable email confirmation to "fix" delivery |

Cost: $0 within Resend's free tier. The domain is already owned.
