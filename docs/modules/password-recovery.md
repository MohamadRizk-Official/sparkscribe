# Password-reset sessions (`src/lib/recovery.js`)

A reset link signs the browser in with a session whose newest sign-in method is `recovery`. That session exists only
so the person can choose a new password; it must not double as a way into the app. See also `docs/auth/README.md`.

## Rules
- On `/auth?mode=update`, within `RECOVERY_WINDOW_S` (900 s, 15 minutes) of opening the link, the session may set a new password.
- Anywhere else, a fresh one is sent back to that form, and an older one is signed out in this browser (`guardRecovery`).
- After the new password is saved, the session is signed out and the person signs in again.
- The token's claims are read only to decide what to show; Supabase checks every request itself.

## Functions
- `recoveryAge(session)`: seconds since the link was opened, if the session's **newest** `amr` entry is `recovery`, else `null`.
- `isFreshRecovery(session)`: age is below the window.
- `endSession({ everywhere })`: ends the session in this browser whatever happens on the network. `everywhere` asks Supabase for a global sign-out and returns `'global'` on success, otherwise `'local'`; if the local sign-out also fails, the stored `sb-<ref>-auth-token` key is removed.
- `guardRecovery(session, pathname)`: returns `true` when the page is navigating away.

## Reset links from our own emails (`#token_hash=...&type=recovery`)
Supabase gives a session from such a link the method `otp`, which cannot be told apart from a normal sign-in. So the
link never becomes a session: `keepResetLink` stores it in this tab only (`sessionStorage`, key `sparkscribe.resetLink`),
the form opens without a session, and the token is used once, in a separate in-memory client, when the new password is submitted.
- `peekResetLink()` returns it only if it is at least 10 characters and younger than 1 hour (the link's own lifetime), else drops it.
- `takeResetLink()` returns it and removes it (single use). `dropResetLink()` removes it.
- Storage errors (blocked storage) are swallowed.
