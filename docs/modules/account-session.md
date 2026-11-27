# Signed-in state and private pages (`src/lib/account.js`)

Three small functions decide whether a page treats the visitor as signed in. See also
[account-actions.md](account-actions.md) (sign-out, deletion) and [password-recovery.md](password-recovery.md).
Tests: `tests/account-session-unconfigured-test.mjs` (accounts off) and `tests/account-session-configured-test.mjs`
(accounts on, with the auth server replaced by a stand-in).

| function | what it checks | cost |
|---|---|---|
| `getSession()` | the session this browser has stored | local, no network; good for showing or hiding UI |
| `getUser()` | the person, **verified with the auth server** | one request; use before showing private data |
| `requireUser()` | `getUser()` plus recovery and consent rules | for every private page |

## When accounts are not configured
Without the Supabase address and key in the build (`isConfigured` is false) `getSession()` and `getUser()` both return
`null`, `changeEmail()` answers "Accounts aren’t available here." and `signOut()` does nothing. No request is made.
The transcription tool itself keeps working; only account features hide.

## `getUser()` cleans up a rejected session
If the auth server says no (the session expired, was revoked, or the user was deleted), `getUser()` returns `null` **and
signs out locally** (`scope: 'local'`). Without that, the sign-in page would still see a stored session, think the
person is signed in and send them back to the private page, which would reject them again, in a loop.

## `requireUser()` step by step
1. No verified user: `location.replace('/auth?next=<this page, with its query>')`. The returned promise **never
   resolves**, so the rest of the page does not run while the browser navigates.
2. A password-reset session (see `guardRecovery` in [password-recovery.md](password-recovery.md)) is not a way into the
   app: it is ended and the page stops.
3. No consent (`terms_accepted_at` and `age_13_plus_confirmed_at` both in the account's metadata) and the page is not
   one of `/auth`, `/terms`, `/privacy`: `location.replace('/auth?mode=consent&next=<this page>')`, again never resolving.
   Those three pages stay readable so a person can read what they are agreeing to.
4. Otherwise it resolves with the user.

`next` is always built from `location.pathname + location.search` and passed through `encodeURIComponent`;
`safeNext()` checks it again when the sign-in page uses it (see `tests/account-helpers-test.mjs`).
