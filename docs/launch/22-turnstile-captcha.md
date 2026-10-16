# Cloudflare Turnstile CAPTCHA on sign-up, sign-in and password reset

SparkScribe sends a Cloudflare Turnstile token with every Supabase Auth request that Supabase's CAPTCHA protection covers:

| Flow | Supabase call | Token |
|---|---|---|
| Create account (email) | `signUp` | yes |
| Sign in (email + password) | `signInWithPassword` | yes |
| Forgot password (send reset link) | `resetPasswordForEmail` | yes |
| "Send the link again" (confirmation email) | `resend` | yes |
| Delete account (password check) | `signInWithPassword` | yes |
| Google sign-in | `signInWithOAuth` | not needed (Supabase doesn't apply CAPTCHA to OAuth) |
| New password from a reset link | `updateUser` | not needed |
| 13+ / Terms confirmation | `updateUser` | not needed |

## How it behaves

- **Widget.** It is Cloudflare's **Managed** widget with appearance `interaction-only`. Usually nothing is visible and the check finishes in about a second. A checkbox appears only when Cloudflare wants a person to confirm; it is centred, full width on phones.
- **Single-use tokens.** Each request gets a fresh token, and the next one starts right after (tokens are single use, valid 5 minutes).
- **Expired tokens** are refreshed automatically and are never sent.
- **Submitting early.** If the person submits before the check finishes, the button shows it's working and the request waits for the token, up to 30 s.
- **Failures never lock anyone out by themselves.** If the widget can't produce a token (Cloudflare unreachable, a content blocker, a host missing from the widget's hostname list), the request is still sent, without a token. **Supabase is the only gate:**
  - While its CAPTCHA protection is off, people sign in as usual.
  - Once it's on, Supabase refuses the request, and the page explains that the security check couldn't run. The next submit tries the check again.
  - Found on the Preview: an unlisted host gives Cloudflare error 110200, and before this change it would have blocked sign-in even with Supabase's CAPTCHA off.
- **Rejected tokens.** If Supabase rejects a token (`captcha_failed`), the page says the security check didn't go through and nothing was sent. The next attempt uses a new token.

## Configuration

- `VITE_TURNSTILE_SITE_KEY` holds the **public** Site Key, as a Vercel environment variable (type: plain or encrypted, not "sensitive"; Vite reads it at build time).
  - When it is empty or absent, the feature is **off**: nothing is loaded and no token is sent, exactly as before.
  - While Supabase's CAPTCHA protection is off, Supabase ignores the token, so the site can ship before protection is on.
- The **Secret Key** goes only into Supabase → Authentication → Attack Protection → CAPTCHA (Turnstile). It never appears in this repository, the browser, or logs.
- **Content Security Policy.** The report-only policy in `vercel.json` allows `https://challenges.cloudflare.com` for scripts and frames, which Turnstile needs.

## Activation order

The Preview and Production share **one Supabase project**. Turning CAPTCHA on there applies to every deployment at once, including today's live site, which has no widget. Turning it on before Production sends tokens would stop everyone from signing in or signing up on the live site.

1. **Cloudflare → Turnstile → your widget → Hostnames:**
   - add `www.spark-scribe.com` and `spark-scribe.com`;
   - add each Preview host you test on, for example `sparkscribe-git-release-four-tier-moerizz.vercel.app`;
   - add `localhost` if you test locally with the real key.
2. **Vercel → Settings → Environment Variables:** set `VITE_TURNSTILE_SITE_KEY` to your **Site Key**, for Preview (`release/four-tier`) and later for Production. Then redeploy.
   - The Preview currently has Cloudflare's always-pass **test** key `1x00000000000000000000AA`. That proves the integration, but Supabase would reject its tokens once CAPTCHA is on, so replace it with your Site Key first.
3. **Check the Preview with your key:** sign up, sign in, wrong password then the right one, forgot password, and Google. Every flow should work as before, and Supabase's logs show no CAPTCHA errors.
4. **Release to Production** with the Site Key set (part of the release in docs/launch/21-release-runbook.md, after your approval). Verify sign-in on www.spark-scribe.com.
5. **Only then:** Supabase → Authentication → Attack Protection → enable CAPTCHA protection, provider Turnstile, and paste the **Secret Key** there yourself.
6. **Verify again on the real domain:** sign in, sign up and password reset should work. Then send a sign-in request without a token, for example with `curl` to `/auth/v1/token?grant_type=password`, and confirm it is refused.

**Rollback.** If anything goes wrong after step 5, turn CAPTCHA protection off in Supabase. Sign-in works immediately, with or without the widget.

## Tests

| Where | What | Result |
|---|---|---|
| Harness, CAPTCHA build (Cloudflare test key; Turnstile stand-in) | `qa/e2e/captcha.e2e.js` `run()`, with the mock requiring a valid, unused token like Supabase: tokens on sign-in, sign-up, resend and reset; a fresh token after a failed attempt; Supabase rejecting a token; Cloudflare failing (no request sent); expired token refreshed; slow check; interactive challenge shown and hidden; no widget for the reset-link password or the age/Terms step; Google not held up | 11/11 |
| Same build | existing auth suite, age/Terms confirmation suite, delete-account suite (password check carries a token) | 11/11, 3/3, 5/5 |
| Same build, **real Cloudflare script** (test key, no stand-in) | widget invisible; sign-in sent Cloudflare's test token and succeeded with the token required | pass |
| Harness, build **without** a Site Key | `off()`: nothing loaded, no token, sign-in works; with the token required, sign-in is refused (why the activation order matters); existing auth and confirmation suites | 2/2, 11/11, 3/3 |
| Deployed Preview `4c275bd` (sparkscribe-git-release-four-tier…) | Real Cloudflare script loads; the widget stays invisible (0 px) and produces a token (Cloudflare test key); the report-only CSP allows challenges.cloudflare.com; the Google button is unchanged | pass |
| Shared Supabase project (CAPTCHA **off**) | `/auth/v1/recover` with a token, for a non-existent example.com address: accepted (HTTP 200), so shipping the widget first is safe | pass |
