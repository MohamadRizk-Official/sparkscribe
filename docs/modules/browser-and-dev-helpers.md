# Browser helpers and the mock AI provider

Small helpers in `src/lib/` and `server/ai/mock.js`, read from the code. Tests load the browser modules through `tests/vite-env-hook.mjs` (see [../TESTING.md](../TESTING.md)).

## Account (`src/lib/account.js`)
- `esc(value)`: escapes `& < > " '`; `null` / `undefined` become empty text.
- `safeNext(value, fallback = '/')`: the guard for `?next=` redirects. Keeps a path that starts with `/` and resolves to this site's origin (returned as path + query + hash). Anything else (an absolute URL, `//host`, backslashes, control characters such as a tab or new line, `javascript:`, a non-string) returns the fallback. **Known gap:** see issue 3 in [../FOUND-ISSUES.md](../FOUND-ISSUES.md).
- `hasConsent(user)`: true only when the account's metadata holds both `terms_accepted_at` and `age_13_plus_confirmed_at`.
- `consentUrl(next)`: `/auth?mode=consent&next=<encoded page>`; the default is the current page.

## Transcripts (`src/lib/transcripts.js`)
- `fmtDuration(s)`: `m:ss`, or `h:mm:ss` from one hour; `—` when missing; negative values read `0:00`.
- `langName(code)`: English language name from `Intl.DisplayNames`; the code itself when it can't be resolved.
- `parseTranscriptText(text)`: reads the `.txt` export (`[0:14] Speaker 1:` followed by lines) into `{ time, speaker, text }` turns; lines before the first timestamp are ignored.
- **Pending save:** a recording transcribed before sign-in is kept in localStorage (`sparkscribe.pendingSave`) with its owner and a timestamp. `peekPending()` returns it for up to an hour, then drops it (and the parked audio); a corrupt value reads as nothing. `clearPending({ keepAudio })` removes it, and the parked audio too unless `keepAudio` is set (the audio is about to be re-keyed to the saved recording). All of it tolerates blocked storage.

## Library (`src/lib/library.js`)
- `highlight(snippet)`: search snippets arrive with `\u0002` / `\u0003` around matches. Everything is HTML-escaped first, then the markers become `<mark>` and `</mark>`, so the only tags that can come out are those two.
- `fmtHours(seconds)`: `N min` under an hour, then `1.5 hours` (one decimal below 10) or `12 hours`.
- Page sizes: 24 recordings, 10 search results.

## Preferences (`src/lib/prefs.js`)
Mascot (`on` / `quiet` / `off`, default `on`) and appearance (`system` / `light` / `dark`, default `light`). Always saved in this browser first; announced to the page (`sparkscribe:mascot-pref`, and `sparkscribe:theme` when the resolved theme changes); when signed in and Supabase is configured also written to the account's user metadata (`sparkscribe_mascot`, `sparkscribe_theme`). Unknown values are ignored. `adoptAccountPrefs(user)` applies the account's valid values on a browser that differs, without syncing back.

## Turnstile (`src/lib/captcha.js`)
Active only when the build has `VITE_TURNSTILE_SITE_KEY`. Without it `createCaptcha()` returns an inert widget (`state()` is `off`, `take()` gives `undefined`, `settle()` resolves `off`) and forms send no token. `CaptchaError` has codes `load`, `timeout` and `failed` with user-facing messages (anything else gets the `failed` text). `isCaptchaRejection(error)` is true for the `captcha_failed` code or any message containing "captcha"; `CAPTCHA_REJECTED` is the text shown.

## Mock AI provider
`server/ai/mock.js` stands in for the AI provider in local development (`AI_PROVIDER=mock`; refused in production). It is deterministic, answers after about 0.4 s (streams at about 25 ms a word), and includes bad items on purpose so the grounding and quality checks run every time:
- a key point citing the made-up line number 99999;
- study concepts with invented evidence or an `unreliable` clarity, and weak cards and questions;
- a `grade` task: a shared significant word is `correct`, a broad place word (`worldwide`, `global`, …) is `close`, otherwise `incorrect`.

Switches: `AI_MOCK_FAIL=1` makes every call fail with status 502; `AI_MOCK_UNCOVERED=1` leaves the first core concept out of flashcards and quizzes, which exercises the coverage pass. It says nothing about real answer quality.
