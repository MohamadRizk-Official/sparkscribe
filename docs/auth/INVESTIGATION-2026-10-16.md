# Investigation: "an email link took me straight into my account" (2026-10-16)

Evidence came from three sources: Supabase Auth logs (last 24 h, read-only), probes against the live auth server that
need no credentials and send no email, the deployed Vercel commits, and the code on each branch.

## What Production was actually running

| | Branch / commit | Password reset behaviour |
|---|---|---|
| **Production** (www.spark-scribe.com, sparkscribe-moerizz.vercel.app) | `main` 95bf377 | **Old flow.** A reset link creates a normal Supabase session. The callback sends it to `/auth?mode=update`, but that session can open every page, and after the new password is saved the page goes to `/library`. |
| Preview `release/four-tier` | bf2d676 / 968d96b (since 20:47 UTC) | Fixed flow: the reset session only reaches the form, is signed out after saving, and the person signs in again. |

The fixes in bf2d676 and 968d96b were **never on Production**. Every auth request in the logs came from
`www.spark-scribe.com` (Production), none from the Preview.

## Timeline from the Supabase Auth logs (UTC)

| Time | Event | Meaning |
|---|---|---|
| 20:29:11–14 | `/authorize` (Google) → `/callback` | Signed in with Google on Production |
| 20:29:27 | `/logout` | Signed out |
| 20:29:44 | `/token` password → 400 | Wrong password |
| 20:29:48 | `/recover` + `mail.send` | Reset email requested on Production; redirect accepted (`…/auth/callback?next=/auth?mode=update`) |
| 20:30:09 | `/verify` 303 | Reset link opened |
| 20:30:20 | `/token` grant_type=pkce 200, **Login** | **The reset link created a full session** (the old `main` flow) |
| 20:30:34 | `PUT /user` 422 | First new password refused (same as the old one, or too weak) |
| 20:30:47 | `PUT /user` 200 | Password changed; the old code then went to `/library` while still signed in |
| 21:22–21:27 | `/recover` ×4 (one 429 rate-limited), `/verify` ×5 (3 × 403 "Email link is invalid or has expired") | Reset emails requested **with a redirect Supabase did not accept** (falls back to the Site URL). Old links reopened, so they were refused as used. **No `/token` exchange and no Login follows**: these links did not sign anyone in. |

## Root causes (verified)

1. **Production's reset flow treats a reset link as a sign-in** (`main`: `src/pages/callback.js`, `src/pages/auth.js`
   update mode, `src/lib/account.js` has no recovery check). Supabase *does* create a session when a reset link is
   opened (PKCE code exchange; the token's `amr` says `recovery`); `main` treats it like any login. **This is the
   genuine flaw**, and it explains 20:30.
2. **The Preview's host is not an allowed redirect in Supabase.** A probe of `/auth/v1/verify` with an invalid token
   shows where Supabase sends each `redirect_to`:
   - allowed: `https://www.spark-scribe.com/auth/callback…`, `https://sparkscribe-moerizz.vercel.app/auth/callback`
   - **not allowed** (sent to the Site URL `https://www.spark-scribe.com/` instead):
     `https://sparkscribe-git-release-four-tier-moerizz.vercel.app/…`, any `sparkscribe-*-moerizz.vercel.app` deployment,
     `https://spark-scribe.com/…`, localhost.

   So **an email link requested from the Preview opens Production's home page**, where the PKCE code can't be
   exchanged (the verifier is in the Preview's storage). If that browser was already signed in to Production, it
   *looks* as if the link signed you in, but it was the existing session. The 21:2x events match this exactly
   (verify, no exchange, no login).
3. **Production's links work only in the browser that asked for them** (PKCE `{{ .ConfirmationURL }}`). Opened on a
   phone or another browser they fail. Mail scanners that open links ahead of the reader (Outlook Safe Links, some
   university gateways) can use them up before the person clicks (Supabase documents this).
4. **Also found while testing:** Production's `safeNext` accepted `next=/%09/evil.example`, which browsers read as
   `//evil.example`, an **open redirect** after sign-in and after Google sign-in. It was fixed on the Preview branch
   earlier (finding D4) and never released.
5. **Production shows raw server text:** the callback shows `error_description` from the URL (anyone can craft a link
   that puts text on the page), and the sign-in page shows unrecognised Supabase errors as is.

## Answers to the questions asked

| Question | Answer |
|---|---|
| Does clicking a recovery link create a Supabase session? | Yes, always (Supabase design). The token's newest `amr` entry is `recovery`. |
| Can that session reach protected routes? | **On Production today: yes.** In the auth release: no. Every page runs `guardRecovery` (fresh → back to the form, older than 15 min → signed out), and the API refuses it (403 `recovery_session`). |
| Is a recovery session treated like a normal login? | On Production: yes. In the release: no. |
| Server-side vs client-side guards | Pages are static. Data is protected by Supabase Row Level Security per user, and the AI API verifies every token with Supabase. Whoever holds a valid reset link can always set a new password and then sign in, so the reset-session restriction is about not *accidentally* entering the app, not a boundary against the link holder. The release adds a server-side refusal of reset sessions on the API as defence in depth. |
| Can session restoration bypass email confirmation? | No. `mailer_autoconfirm` is false; Supabase issues no session to an unconfirmed email/password account (sign-in returns `email_not_confirmed`). |
| Can onboarding be bypassed? | Production has no age/Terms step today, and the release keeps that (owner decision 2026-10-16: it ships with the approved legal pages). Email verification can't be skipped (above). |
| Can an existing session interfere with verification? | In the release, our own verification links are checked in a separate in-memory client, so a different signed-in account stays as it is and is told so. Old `?code=` links replace the session in that browser (Supabase client behaviour), then sign out to "please sign in". |
| Can a recovery session be reused? | The link is single use (Supabase). After saving, the session is signed out (global scope). Opening the form again shows "expired or already used". |
| Do old links behave differently? | Yes: links already sent use `{{ .ConfirmationURL }}` (PKCE). The release still handles them, the same way as before for Google sign-in, and with the new reset/verify rules. New templates use first-party links. |
| Competing auth listeners / redirect loops? | One `onAuthStateChange` per page (account menu). The guards use `location.replace` to fixed pages and `/auth` is exempt, so there are no loops (tested). |
| Can stale deployments explain it? | Partly: Production is on the old commit. The Preview links landed on Production because of the redirect allow list. |
| Does a successful reset end the recovery session? | Production: no (it continues into `/library`). Release: yes (global sign-out; local fallback if the network fails). Other devices: refresh tokens are revoked; access tokens already issued stay valid until they expire (≤ 1 h by default), so this is **not** an instant revocation. |
| Can a user reach another account through session confusion? | No path found. Sessions are per browser storage; a link can only sign in its own account. The release never mixes the confirming account into an existing session. |

## Follow-up 2026-10-17: the branded reset link opened a normal session
After the branded templates went live (config reload 04:19 UTC), a real reset at 04:31 showed `POST /verify` 200 +
Login, then the form said "request a reset link", and the same session made `PUT /user` calls from the home page.
Root cause: Supabase's `verifyPost` (used for `token_hash` links) always records the sign-in method `otp`, never
`recovery`, so `lib/recovery.js` could not recognise it, and the session counted as a normal sign-in. Fixed in 66fff07:
a reset link is used only together with the new password, in an in-memory client, and never stored (README.md).

## Fixed in `release/auth` (branch from `main`)
See `docs/auth/README.md` for the design and `docs/auth/RELEASE.md` for the tests and rollout.
