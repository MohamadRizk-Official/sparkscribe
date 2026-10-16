# Branded auth email: Resend + spark-scribe.com + Supabase

Goal: every auth email comes from **SparkScribe &lt;no-reply@spark-scribe.com&gt;**, uses the SparkScribe templates, and
links to www.spark-scribe.com. Today Supabase's built-in mailer sends them. That mailer only delivers to members of
the Supabase organisation and is rate-limited, so it can't serve real users.

Steps marked **(owner)** need your accounts; nothing here needs a secret to pass through this repository or a chat.

## 1. What the domain has today (checked 2026-10-16 via public DNS)
| Record | Value | Effect |
|---|---|---|
| `spark-scribe.com` TXT (SPF) | `v=spf1 -all` | "this domain sends no mail" |
| `_dmarc.spark-scribe.com` TXT | `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s` | reject anything that fails; **strict** alignment |
| MX | none | the domain receives no mail |
| `resend._domainkey`, `send` | none | Resend not set up yet |
| Nameservers | Squarespace (`nsc1–4.squarespacedns.com`) | records are edited in Squarespace → Domains → DNS |

**Why Resend still works without weakening anything:** DMARC passes if **either** SPF or DKIM passes *and aligns*.
Resend signs with DKIM as `d=spark-scribe.com` (exactly the From domain, so it aligns even under `adkim=s`). Its bounce
address uses the subdomain `send.spark-scribe.com`, which gets its own SPF record. **Do not edit the root SPF** (`-all`
stays right for the root, and a second root SPF record would break SPF) and **do not relax DMARC**. With strict DMARC
and `p=reject`, a missing or wrong DKIM record means every email is rejected, so verify before switching Supabase over.

## 2. Resend account and domain (owner)
1. Create an account at resend.com (the free plan's daily and monthly limits are on Resend's pricing page; check they
   cover your expected sign-ups and resets).
2. **Domains → Add domain → `spark-scribe.com`**. Pick a region close to your users (e.g. `eu-west-1` or `us-east-1`).
3. Resend shows 3–4 records. Typical shapes (copy the exact values from Resend; the DKIM key is unique to your account):

   | Type | Host (in Squarespace, without the domain) | Value | Priority |
   |---|---|---|---|
   | TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3…` (from Resend) | |
   | MX | `send` | `feedback-smtp.<region>.amazonses.com` | 10 |
   | TXT | `send` | `v=spf1 include:amazonses.com ~all` | |
   | TXT | `_dmarc` | **skip**: one already exists (keep it) | |

4. In Squarespace → Domains → spark-scribe.com → DNS → Custom records, add exactly those records. Don't change the
   nameservers or any existing record.
5. Back in Resend, press **Verify**. DNS can take minutes to hours. Tell me when it says *Verified* and I'll re-check
   the public records.
6. In the domain's settings, keep **click tracking and open tracking off** (tracking rewrites links, which breaks
   single-use auth links; Supabase recommends it off).

### Three different credentials (don't mix them up)
| What | What it is | Secret? | Where it goes |
|---|---|---|---|
| DNS records (DKIM key, SPF, MX) | proof the domain allows Resend to send | **No**, public | Squarespace DNS |
| Resend **API key** | the key Resend issues; for SMTP it *is* the password | **Yes** | only into Supabase's SMTP password field |
| SMTP username | always `resend` | no | Supabase |

Create the API key with **Sending access** only, limited to the domain `spark-scribe.com`, named e.g.
`supabase-auth-smtp`. Copy it straight into Supabase (step 3). Don't store it in GitHub, Vercel, a `.env` file or a
chat. Resend shows it once; if lost, make a new one.

## 3. Supabase SMTP (owner, after the auth release is live, see RELEASE.md)
Supabase → Project → **Authentication → Emails → SMTP Settings → Enable custom SMTP**:

| Field | Value |
|---|---|
| Sender email address | `no-reply@spark-scribe.com` |
| Sender name | `SparkScribe` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | the Resend API key from step 2 |
| Minimum interval per user | keep 60 s (stops repeated sends to one address) |

Then **Authentication → Rate Limits → "Rate limit for sending emails"**. With custom SMTP Supabase starts low
(about 30/hour). Raise it to what your Resend plan allows per hour.

## 4. Templates (owner, same session as step 3)
Generated files are in `docs/auth/email-templates/`; preview them all in a browser via `preview.html`. In
**Authentication → Emails → Templates**, for each template paste the **subject** from `subjects.json` and the
**HTML** of the file:

| Supabase template | File | Subject |
|---|---|---|
| Confirm sign up | `confirm-signup.html` | Verify your email address — SparkScribe |
| Reset password | `reset-password.html` | Reset your SparkScribe password |
| Magic link | `magic-link.html` | Your SparkScribe sign-in link |
| Change email address | `change-email.html` | Confirm your new email address — SparkScribe |
| Invite user | `invite.html` | You’re invited to SparkScribe |
| Reauthentication | `reauthentication.html` | Your SparkScribe verification code |
| Security → Password changed (turn on) | `password-changed.html` | Your SparkScribe password was changed |
| Security → Email address changed (turn on) | `email-changed.html` | Your SparkScribe email address was changed |
| Security → Sign-in method linked (optional) | `identity-linked.html` | A sign-in method was added to your SparkScribe account |

**Important:** templates are project-wide (Preview and Production share them) and their links need the auth release's
callback page. Paste them **only after Production serves the auth release**; until then the old Production code can't
open `#token_hash=` links. To roll back, use Supabase's "Reset to default" on a template (that brings back
`{{ .ConfirmationURL }}` links, which work with any version of the app).

Design notes: table layout with inline styles (Gmail, Outlook incl. VML button, Apple Mail, mobile); hosted PNG logo
(`https://www.spark-scribe.com/email/sparkscribe-mark.png`) plus a text wordmark; dark-mode styles for clients that
support them; preheader text; plain fallback link under the button; no tracking pixels; no Supabase branding. Supabase
sends HTML only (no separate plain-text part), so the content is short, readable text.

## 5. Testing (owner + me)
1. Supabase: send yourself a password reset from www.spark-scribe.com, and sign up with a new address you own.
2. In Gmail: **Show original** → `SPF: PASS (send.spark-scribe.com)`, `DKIM: PASS (spark-scribe.com)`,
   `DMARC: PASS`. In Outlook.com: check the message isn't in Junk.
3. From: `SparkScribe <no-reply@spark-scribe.com>`, the logo shows, the button and the fallback link both point to
   `https://www.spark-scribe.com/auth/callback#…`.
4. Resend → Emails: each message shows *Delivered*.
5. Open a reset email on a *different* device or browser from where you asked: it must still work (first-party link).

## 6. Rotation and incidents
* **Rotate the key**: Resend → create a new Sending key → paste into Supabase SMTP password → send a test reset →
  delete the old key in Resend.
* **Leaked key**: delete it in Resend immediately (sending stops), then rotate as above.
* **Resend outage**: Supabase can't send auth emails; switching SMTP off falls back to Supabase's mailer, which only
  reaches organisation members, so treat it as an outage, not a fallback.
* Optional later: add `rua=mailto:…` to DMARC to receive aggregate reports (needs a mailbox that receives mail).
