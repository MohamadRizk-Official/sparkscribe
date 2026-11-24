# Settings page (`src/pages/settings.js`)

`/settings` has four sections: **Account**, **Plan & billing** (a summary), **Preferences** and **Privacy**. It works signed out: preferences are kept in this browser, and also on the account when signed in. Nothing here decides what a plan allows: every check happens on the server.

## Page start
- `mountAccountMenu` re-renders the Account section whenever the session changes; `getSession().then(renderAccount)` does the first paint; `mountMascot({ page: 'other' })` adds the mascot.
- `trackSections` marks the navigation link of the section in view as current.

## Plan & billing summary (`renderBilling`)
Display only, from `getBillingStatus()`:
| state | shown |
|---|---|
| signed out | "Free to start" and a link to `/pricing` |
| status can't be loaded | "Your plan couldn't be loaded just now" with a link to `/account` |
| signed in | plan name, a renewal line, a usage meter, a payment-problem warning if any, and buttons |

Renewal line, in this order of precedence: cancelled at period end → "Ends <date>, then Free."; Free → "Resets <date>."; yearly → "Billed yearly, renews <date>. Time renews <date>."; otherwise "Renews <date>.". Dates are shown in UTC (`dateText`) so a US evening never shows the day before a reset. Usage uses `usageParts` and `usageLevel` ([billing-display.md](billing-display.md)); the meter's width is capped at 100%. The main button reads "Upgrade" on Free and "Manage plan & billing" otherwise.

A guard (`billingFor`) stops a slow response from a previous user from painting over the current one.

## Change email
Supabase sends the confirmation link(s); nothing changes until a link is opened. The link lands on `/auth/callback` (type `email_change`), which confirms it without signing anyone in. With Supabase's secure email change both the old and the new address get a link.

## Delete account
Shown only in a build with `VITE_ACCOUNT_DELETION=1`, which must ship in the same release that applies the database function (`supabase/proposed/*_account_deletion.sql`). The dialog lists what is removed (transcripts and speaker names, insights and Ask answers, Create output, folders and preferences, the sign-in), says a paid plan is cancelled immediately, and that audio was never uploaded.

The delete button stays disabled until the typed word is exactly `DELETE` (after trimming) and, for accounts that sign in with email, a password has been entered. Checking the password signs in again, which Supabase protects with the same Turnstile CAPTCHA as the sign-in page (see [captcha.md](captcha.md)): the page waits up to 10 s for the check, never hands a token out twice, and turns a "security check" error from the server into a friendlier message when the widget itself failed. A wrong password clears the field. Success redirects to `/settings?deleted=1`, and the page then removes that query string.

## Preferences and privacy
- **Mascot** (on / quiet / off) and **Appearance** (system / light / dark): [prefs.md](prefs.md).
- **Quiz sounds**: this browser only ([quiz-sound.md](quiz-sound.md)).
- **Keep original audio on this device**: on/off switch, a count and size of what is stored, and a "clear" button ([audio-store.md](audio-store.md)). If the browser can't keep audio (private window, storage off) the page says so, and recordings can still be attached to play along.

Browser-only: no automated test of its own.
