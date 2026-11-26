# Account actions (`src/lib/account.js`)

Sign-in state, consent, changing the email, signing out and deleting the account. The page that shows these is [account-page.md](account-page.md); the header menu is `mountAccountMenu` in the same file. Calls go to Supabase Auth directly, except account deletion, which goes through the server (`/api/billing`, see [billing-display.md](billing-display.md) and `docs/api/billing.md`).

When Supabase is not configured (no URL or key), `getSession`/`getUser` return `null`, `signOut` does nothing, `changeEmail` returns an error object and `deleteMyAccount` throws "Accounts aren't available here."; the transcription tool itself keeps working.

## Reading the user
| function | notes |
|---|---|
| `getSession()` | fast, local: reads the stored session. Good for UI state, not for protecting a page |
| `getUser()` | asks the auth server. A stored session the server rejects (expired, revoked, user deleted) is **cleared from this browser** and `null` is returned, so the sign-in page cannot think you are signed in and bounce you back in a loop |
| `requireUser()` | for private pages: a signed-out visitor is sent to `/auth?next=<this page>`; a password-reset session is sent back to the reset form or signed out ([password-recovery.md](password-recovery.md)); an account without consent goes to `/auth?mode=consent&next=…` (except on `/auth`, `/terms`, `/privacy`, where people read what they agree to). While navigating it returns a promise that never settles, so the page stops rendering |

## Consent (13+ and Terms)
Every account confirms once that they are 13 or older and accept the Terms. An email sign-up records it at sign-up; a Google account is asked on its first visit. It is stored in the user's metadata as two times, `age_13_plus_confirmed_at` and `terms_accepted_at`.

- `hasConsent(user)` is true only when **both** are present.
- `recordConsent()` stores both with the same current time and returns the updated user; a failed save is thrown.
- `consentUrl(next)` builds `/auth?mode=consent&next=<encoded path>`; `next` defaults to the current page.

## Changing the email
`changeEmail(email)` asks Supabase to change it. Supabase emails a confirmation link and **changes nothing until it is opened**. It never throws: it returns `{ user, error }`, with `user: null` when the change was refused.

## Signing out
`signOut()` removes what this browser parked for the signed-in person: the transcript waiting for sign-in (`sparkscribe.pendingSave`) and its audio, and old Across answers older versions kept (`sparkscribe.across.*`). Ordinary preferences stay. Then it signs out of Supabase.

## Forgetting this browser
`forgetThisBrowser()` removes every `sparkscribe…` key from `localStorage` and `sessionStorage` **except** the device-level settings `sparkscribe.theme` and `sparkscribe.modelsCached` (theme and "speech models downloaded"), and deletes the original recordings kept on this device for playback. Keys that do not start with `sparkscribe` are never touched.

## Deleting the account: `deleteMyAccount(password, captchaToken)`
Every refusal throws an `Error` with a sentence for the person; **nothing is deleted when it throws.** In order:

1. Not configured → "Accounts aren't available here."
2. No signed-in email → "Sign in again to delete your account."
3. If `password` is not `null`, sign in again with it (the database refuses deletion unless the latest sign-in is under 10 minutes old). A failed security check ("captcha") says the check did not go through and nothing was deleted; a wrong password says "That password isn't right."; anything else shows Supabase's message. Accounts without a password (Google) pass `null` and skip this step.
4. Ask the server to delete (`delete_account`, with the confirmation word). The server cancels any Stripe subscription first, so nobody keeps paying for a deleted account. Server failures with the codes `network`, `deletion_unavailable` or `deletion_failed` show their own message; every other failure shows a generic "couldn't be deleted, and nothing was removed" (no internal details).
5. If the server answers `deleted: false`: reason `subscription` → cancel the paid plan first; otherwise with a password → "Please enter your password again."; without one → sign out and in again, then delete within 10 minutes.
6. On success: `forgetThisBrowser()`, then the local session is dropped.

Test: `tests/account-actions-test.mjs` (every branch above), plus `tests/account-helpers-test.mjs` and `tests/account-redirect-edges-test.mjs` for the pure helpers (`esc`, `safeNext`).
