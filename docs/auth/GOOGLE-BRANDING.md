# Google sign-in branding: "strkrrdndoofpcenopxk.supabase.co" on Google's account chooser

## Why it shows
Google names the site that receives the sign-in. For SparkScribe that is Supabase Auth's callback,
`https://strkrrdndoofpcenopxk.supabase.co/auth/v1/callback` (the project's default domain). Until the app's brand is
verified by Google, the chooser shows that host instead of an app name.

## Facts (checked 2026-10-17)
| Item | State |
|---|---|
| Supabase plan | **Free** (organization "SparkScribe") |
| Supabase custom domain (e.g. `auth.spark-scribe.com`) | paid add-on for projects on a **paid plan**: $10/month add-on (Supabase docs), plus the Pro plan (about $25/month; check Supabase's pricing page) |
| Vanity subdomain (`<name>.supabase.co`) | experimental; no add-on charge, but listed with custom domains (paid plans); still shows `supabase.co` |
| Google brand verification (name + logo on the consent screen) | free; done in Google Cloud → Google Auth Platform → **Branding** and **Verification**; "may take a few business days" (Supabase's Google guide) |
| Scopes used | `openid`, `email`, `profile` only (non-sensitive: no security assessment needed) |

## Options
1. **Google brand verification (recommended first, free, no downtime, no code or Supabase change).**
   In Google Auth Platform → Branding, set:
   - App name **SparkScribe**
   - Support email
   - Logo: a square PNG of the mark, e.g. `public/email/sparkscribe-mark.png` scaled to 120×120
   - Home page `https://www.spark-scribe.com`
   - **Privacy policy URL** and Terms URL on spark-scribe.com
   - Authorized domains: `spark-scribe.com` and `supabase.co` (the redirect host)

   Prove ownership of spark-scribe.com in Google Search Console (a DNS TXT record in Squarespace, additive). Then
   submit for verification. Once verified, the chooser and consent screen show SparkScribe and its logo.

   **Prerequisite: a public Privacy Policy page.** Production has none today; the drafts on `release/four-tier` are
   held by the legal guard. So this step depends on approving and publishing the Privacy Policy (and Terms).
2. **Custom auth domain (`auth.spark-scribe.com`): later, if wanted.** Upgrade to Pro, add the custom-domain add-on (about
   $35/month together), add a CNAME in Squarespace, add `https://auth.spark-scribe.com/auth/v1/callback` in Google
   **in addition to** the current callback, then activate. The `supabase.co` domain keeps working, so existing sessions,
   the app's `NEXT_PUBLIC_SUPABASE_URL` and the email templates (links go to www.spark-scribe.com) are unaffected. Do it
   at a quiet time and test Google sign-in right after. Rollback: remove the domain; the old callback is still allowed.

## Risks
Option 1 changes nothing in the sign-in path: there is no risk to sessions or accounts. While Google reviews, sign-in
keeps working as now. Don't remove or change the existing OAuth client, its Client ID/Secret, or the existing redirect
URI in either option.
