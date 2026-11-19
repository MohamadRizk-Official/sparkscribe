# Turnstile CAPTCHA widget (`src/lib/captcha.js`)

Wraps Cloudflare Turnstile in front of Supabase Auth's CAPTCHA protection. Covered by `tests/captcha-test.mjs`.

## When it is on
- Only when the build has a public `VITE_TURNSTILE_SITE_KEY` matching `/^[0-9A-Za-z_-]{10,}$/` (`captchaEnabled`).
- Without a key nothing is loaded and no token is sent. `createCaptcha()` returns an inert object whose `state()` is
  `'off'` and whose `take()` returns `undefined`.
- The Secret Key lives only in Supabase (Authentication → Attack Protection) and never reaches this code.
- Protected: email sign-up, password sign-in, password-reset and confirmation emails, and the password check before
  account deletion. Not needed: Google sign-in, and setting a new password from a reset link.

## States
| state | meaning |
|---|---|
| `loading` | script or widget starting |
| `verifying` | Cloudflare is checking, no input needed |
| `interactive` | Cloudflare shows its checkbox and waits for the person |
| `ready` | a fresh, unused token is available |
| `expired` | the token ran out unused; Cloudflare fetches a new one |
| `error` | the challenge failed (`retry()` starts again) |
| `unavailable` | the script could not load, or the browser is unsupported |

The container gets `data-captcha="<state>"` and, while interactive, the class `is-interactive`.

## API of `createCaptcha(container, { action, onChange })`
- `take()`: returns the token only in state `ready`, then clears it and moves to `verifying`. A token is never handed
  out twice (Turnstile tokens are single use and expire after five minutes).
- `settle(timeoutMs = 10000)`: waits until the state is `ready`, `interactive`, `error` or `unavailable`, or the timeout
  passes, and resolves with the state at that moment.
- `reset()`: after every request, drop any leftover token and start the next challenge.
- `retry()`: start over after an error; reloads the script if it never loaded.
- `onChange(fn)`: subscribe; returns an unsubscribe function. A throwing listener is ignored.
- `remove()`: remove the widget and all listeners.

## How a form should use it
It never waits on `interactive` (it tells the person to complete the check). It waits briefly on loading, verifying
and expired through `settle()`. On `error` or `unavailable` it sends without a token and lets Supabase decide.

## Errors
`CaptchaError(code)` with codes `load`, `timeout`, `failed` (any other code gets the `failed` message).
`isCaptchaRejection(error)` is true for Supabase's `captcha_failed` code or any message containing "captcha".
The script load times out after 15 seconds.
