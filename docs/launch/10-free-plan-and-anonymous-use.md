# Anonymous transcription and the Free plan's 60-minute allowance

Status: **analysed and tested; the sign-in requirement is unchanged (anyone can transcribe on their device).** The choice
below is yours.

## 1. How it works today (verified)

| Step | Who | Counted against an allowance? | Enforced where |
|---|---|---|---|
| Transcribe a file | anyone, signed in or not | **no**: it runs entirely on the device (no server, no cost to SparkScribe) | — |
| Export TXT/PDF/Word/subtitles of that result | anyone | no | — |
| **Save to My Library** | account only | **yes**: the recording's length is recorded the moment it's saved | database trigger on insert (atomic, per-user lock); refused with `quota_exceeded` when `billing_settings.enforce_quota` is on |
| Anonymous result saved after signing in ("sign in to save") | account | **yes**, the same trigger, at save time | same; tested: refused saves explain why and offer **Download text** (commit 70cf937) |
| AI features (Summary, Notes, Ask, Create…) | account only | separate AI limits (hourly + monthly), not minutes | AI ledger (`ai_reserve`), fails closed |
| Deleting a saved recording | account | time is **not** given back | usage rows are immutable |

Signed-in users also get a check before transcription starts (`/api/billing authorize`) when enforcement is on, so they
learn up front that a recording won't fit. The database re-checks at save regardless.

Tests:
- SQL billing: 42 checks, including "a save longer than the time left is refused", "deleting recordings does not give
  time back" and "usage rows cannot be edited or inserted by users".
- Browser: "anonymous transcript over the monthly time is refused, explained and still downloadable".

## 2. Can someone bypass the 60 minutes?

| Path | What they get | Cost to you | Can it be secured? |
|---|---|---|---|
| Transcribe without an account and export | unlimited on-device transcripts, no library, no AI | **none** (their device; models come from Hugging Face's CDN) | not on the server: the work never reaches it. Any client-side cap is bypassable, though it can still shape behaviour |
| Many free accounts | 60 min + AI limits per confirmed email | AI per account (capped) + storage | partly: email confirmation (on), CAPTCHA on sign-up (post-launch), the service-wide AI breaker ($5/day) |
| Report a shorter duration when saving | a cheaper save | storage only | partly: billable time is the longest of reported duration, last line end and words ÷ 4, capped at 100 h |
| Delete the account, sign up again with the same email | a new allowance | small | optional: a hashed-email tombstone (privacy trade-off, not built) |

Conclusion: the allowance already protects everything that costs money (library storage via saved minutes, AI via the
ledger) and is enforced in the database, not the browser. Anonymous use costs nothing and works as your free trial.

## 3. Options (your decision)

| Option | First use | Quota coherence | Change |
|---|---|---|---|
| **A. Keep as is (recommended)** — anyone can transcribe on the device; saving and AI need an account and count against it | best: drop a file, get a transcript | the allowance covers what's saved and AI, which is everything that costs you | none |
| B. A soft anonymous trial cap (for example 15-minute recordings or 3 per day without an account), shown as "create a free account for more" | good | nudge only (client-side, bypassable) | small UI change |
| C. Require an account to transcribe (`VITE_REQUIRE_ACCOUNT=1`) | a sign-up before any value | strongest | build flag only; already built and tested |

If you choose A, make the copy say "60 minutes a month of recordings saved to your library" (the pricing FAQ now does).

## 4. Rollout of minute counting (database settings; production change, needs your approval)

- **At launch:** `metering_starts_at = now()` (start counting from launch; nothing before is counted) with
  `enforce_quota = false`. You see real usage without refusing anyone.
- **When paid plans launch (or earlier if you want the limit enforced):** `enforce_quota = true`.
- **Preview-only trial first:** `enforce_origins = '{https://sparkscribe-git-prelaunch-dev-moerizz.vercel.app}'`.
