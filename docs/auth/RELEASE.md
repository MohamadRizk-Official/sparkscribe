# Auth release: tests, rollout, rollback

Branch **`release/auth`**, made from Production `main` (95bf377). Preview:
`https://sparkscribe-git-release-auth-moerizz.vercel.app`. Contains only authentication and email work; four-tier
pricing, billing, the draft legal pages, the age/Terms step and the redesign stay on `release/four-tier`.

## What changes for users (diff against `main`)
| Area | Before (Production) | After |
|---|---|---|
| Reset link | signs you in; after saving, straight to Library | only the new-password form; after saving you're signed out and asked to sign in with the new password |
| Reset session elsewhere | full access to every page and the API | sent back to the form (or signed out after 15 min); API answers 403 |
| Sign-up link | signs you in | confirms the address; "Email verified. Please sign in." |
| Email links | Supabase URL, same browser only, scanners can use them up | (after the template switch) www.spark-scribe.com link, any browser, nothing happens until the button |
| `next=` redirects | `/%09/evil.example` left the site | same-origin only |
| Error text | server/URL text shown as is | known messages only |
| Sign-in / sign-up / reset email / resend | no CAPTCHA | Turnstile token sent (enforced only once Supabase CAPTCHA is on) |
| Sign-up message | "open it in this browser" | "verify your email address, then sign in" + Send the link again |
| Files | | `auth.html`, `auth/callback.html`, `src/pages/{auth,callback}.js`, `src/lib/{account,supabase,recovery,captcha}.js`, `server/http.js`, 8 lines of CSS, `public/email/sparkscribe-mark.png`, plus docs, templates, generator and QA harness (not deployed code) |

No database migration. No new dependency. No change to billing, transcription, library or AI features.

## Test matrix
Legend: **H** = automated harness (Supabase imitated in the browser), **P** = real Preview with real Supabase,
**L** = real Production (www.spark-scribe.com). "Owner" = needs your real account or inbox (I can't enter
passwords or create accounts on real sites).

| # | Check | H | P | L |
|---|---|---|---|---|
| **Account creation** |
| 1 | Sign-up asks to verify, not signed in | ✅ | owner | owner |
| 2 | Verification link confirms; "Email verified. Please sign in."; email filled | ✅ (token_hash + ?code=) | owner (after SMTP) | owner |
| 3 | Verification with another account signed in leaves it alone | ✅ | — | — |
| 4 | Sign-in before confirming explains + resend | ✅ | owner | |
| 5 | Resend confirmation carries its own Turnstile token | ✅ | | |
| 6 | Duplicate sign-up gets the same neutral answer | ✅ (Supabase behaviour) | | |
| **Password recovery** |
| 7 | Reset email request (+ token), same answer for unknown emails | ✅ | owner | owner |
| 8 | Link → form only; Library/Home go back to the form | ✅ | owner | owner |
| 9 | Mismatch / same / weak password refused, form stays | ✅ | | |
| 10 | Save → signed out (global) → "Password updated successfully…" | ✅ | owner | owner |
| 11 | Old password refused, new one signs in normally | ✅ | owner | owner |
| 12 | Back / Forward / refresh never signed in; `?reset=done` alone shows nothing | ✅ | owner | |
| 13 | Reused link → "expired or already used" | ✅ | ✅ invalid-token probe (403 otp_expired) | |
| 14 | Reset session older than 15 min → signed out | ✅ | | |
| 15 | Cancel ends the reset session | ✅ | | |
| 16 | Different browser (first-party link) | ✅ | owner (after templates) | owner |
| 17 | API refuses a reset session (403) | ✅ `qa/unit/recovery-token.mjs` | | |
| **Authentication** |
| 18 | Correct / wrong password, return to `next` | ✅ | owner | owner |
| 19 | Crafted `next` stays on the site | ✅ | ✅ probe | |
| 20 | Unknown server error → general message | ✅ | | |
| 21 | Double click → one request | ✅ | | |
| 22 | Google sign-in unaffected (no CAPTCHA) | ✅ | owner | owner |
| 23 | Sign-out | existing | owner | |
| **CAPTCHA** |
| 24 | Token on sign-in/up/reset/resend, fresh each time | ✅ | real widget | real widget |
| 25 | Expired, slow, interactive, failed widget; Supabase rejection | ✅ | | |
| 26 | Missing token rejected once Supabase enforces | ✅ (imitated) | | after activation |
| **Email** |
| 27 | Domain verified, SPF/DKIM/DMARC pass | — | owner + DNS check | |
| 28 | Branded templates render (light/dark, mobile) | ✅ preview.html | | owner inbox |
| 29 | Links go to www.spark-scribe.com, nothing used before the click | ✅ | | owner |

Harness results 2026-10-16 (release/auth): recovery 17/17, auth 12/12, captcha 12/12 (with key) and 2/2 (without);
same suites on the no-key build: 17/17, 12/12.

## Rollout order
| Stage | Who | What | Rollback |
|---|---|---|---|
| 1 | owner | Supabase → Auth → URL Configuration → add Redirect URLs `https://sparkscribe-git-release-auth-moerizz.vercel.app/**` and `https://sparkscribe-git-release-four-tier-moerizz.vercel.app/**`. Cloudflare Turnstile widget → add hostname `sparkscribe-git-release-auth-moerizz.vercel.app`. | remove the entries |
| 2 | me + owner | Preview checks (real Supabase): I run the checks that need no credentials; you run the reset with your account (rows 7–12) | — |
| 3 | owner | **Approve the Production release** | — |
| 4 | me | Fast-forward `main` to `release/auth`; confirm Vercel Production serves the commit; checks on www.spark-scribe.com | Vercel → Deployments → previous Production (95bf377) → **Promote** (instant), then revert on `main` |
| 5 | owner (can start now) | Resend domain + DNS records (`EMAIL-SETUP.md` §2). I re-check DNS. | delete the records |
| 6 | owner | Supabase SMTP + templates + security notifications (`EMAIL-SETUP.md` §3–4), after stage 4 | SMTP toggle off; "Reset to default" per template |
| 7 | owner + me | Real emails: sign-up with a new address, reset, other device; headers show SPF/DKIM/DMARC pass | as stage 6 |
| 8 | owner | Supabase → Auth → **Attack Protection → CAPTCHA → Turnstile**, Secret Key, Save. Only after stage 4 is live. | toggle CAPTCHA off (immediate) |
| 9 | me + owner | Right after stage 8: I confirm a request **without** a token is refused (a reset request for a non-existent address, no email sent); you sign in, sign up and request a reset on www.spark-scribe.com | toggle CAPTCHA off |

If any critical check in stages 4, 7 or 9 fails: undo that stage, as in the table, before continuing.

## Known limits (honest list)
* After a reset, other devices lose their refresh tokens; access tokens they already hold stay valid until they expire
  (Supabase default ≤ 1 hour). It isn't an instant revocation.
* Whoever has a valid reset link can set the password (that's what the link is for); the reset-session rules prevent
  *accidental* entry, they aren't a barrier against the link holder.
* Emails already sent before the template switch use Supabase's link: same browser only, and scanners can use them up.
* No age/Terms step in Production until the legal pages are approved (owner decision).
* Supabase sends HTML-only email (no plain-text part).

## Production log
| Date (UTC) | Commit on `main` | What | Vercel deployment |
|---|---|---|---|
| before 2026-10-16 | 95bf377 | previous Production (old auth flow, older UI) | `sparkscribe-qsrx6784n` |
| 2026-10-16 23:20 | 48db417 | auth release (this document) | `sparkscribe-812xrc4fs` |
| 2026-10-17 | 0e0b514 | newer UI ported onto the auth release (branch `release/ui`, see below) | `sparkscribe-cqyjlfs49` |
| 2026-10-17 | 12f461d | phone header fits at 320–400 px (no sideways scroll) | `sparkscribe-1k37eybrr` |

Rollback: `vercel promote <deployment>` with the row you want back, e.g. `sparkscribe-812xrc4fs-moerizz.vercel.app`
(auth release without the UI port) or `sparkscribe-qsrx6784n-moerizz.vercel.app` (before both). Then revert `main` to match.

### The UI port (why Production looked older)
The auth release did not revert any design: it changed 8 lines of CSS. The newer UI had never been on `main`; it lived
on `homepage-v2` (4 commits on top of the old Production) and in later commits on the `release/four-tier` lineage.
`release/ui` = Production + `homepage-v2` merged + only the visual parts of a0872f4 (light default, light-mode colours,
Google button, sign-in prompt, timeline, ripples, processing mascot), 92b1b5f, 743e741, 721dbee (CSS) and the theme
toggle from 2cc8c22. Left out on purpose: pricing, billing, legal pages, the age/Terms step, the "Add slides or PDF"
entry points and the Details popover (they depend on the unreleased speaker-identity work), audio playback storage,
account deletion, AI limits, study engines 2/3, Focused Review / Across. The home page keeps its labelled
"Bring the slides too — Coming soon" section (part of Home v2). Auth suites on `release/ui`: recovery 17/17,
auth 12/12, captcha 12/12 (mocked Supabase).
