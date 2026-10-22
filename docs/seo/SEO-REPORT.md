# SparkScribe — SEO audit, implementation and roadmap (2026-10-22)

Branch `design/polish` (d7e06b9 and later), Preview https://sparkscribe-git-design-polish-moerizz.vercel.app (Vercel marks
every Preview response `X-Robots-Tag: noindex`, so it can't compete with the real site). Production
https://www.spark-scribe.com is unchanged until approval.

## 1. Baseline (live site, measured 2026-10-22)

| Check | Result |
|---|---|
| Host | `https://spark-scribe.com` and `http://` → **308** to `https://www.spark-scribe.com/` ✔ |
| Status codes | public pages 200; unknown URL **404** (not a soft 404) ✔; `/pricing.html` → 308 `/pricing` ✔; `/pricing/` 200 with canonical `/pricing` |
| robots.txt | allows all, names the sitemap ✔ |
| sitemap.xml | 8 URLs (home, pricing, 3 feature pages, help, privacy, terms) |
| Canonicals | one absolute canonical per public page ✔ |
| Titles / descriptions | unique per page ✔ (Home's description 175 chars, truncated in results) |
| Private pages | library, transcript, settings, account, across, auth: `meta robots noindex` ✔ |
| Feature pages | static HTML (crawlable without JS), FAQPage JSON-LD ✔ |
| Pricing HTML | **plans and prices only rendered by JavaScript**; static footer said *"Paid plans coming soon · no payment details are collected"* |
| Social | no `og:image` anywhere; X card `summary` only |
| Structured data | none on Home or Pricing |
| Legal pages | `noindex` but listed in the sitemap (contradiction) |
| Analytics / Search Console / Bing | none found (no tag, no meta, no DNS TXT record) |
| Lighthouse mobile (lab, single run) | Home perf **39** (TBT 3,550 ms, LCP 5.3 s, 486 KB); Pricing 79; Lecture notes 87; SEO 100 on all |

### Root cause of "Paid plans coming soon"
Genuinely in the HTML, not a cache: `pricing.html` shipped that footer text and `pricing.js` replaced it only after the
plans loaded. Any crawler that doesn't run JavaScript (and the first moment for everyone) read the stale line. The plans
themselves were JavaScript-only too, so the page's HTML contained no prices.

## 2. Issues and what was done

| Severity | Issue | Fix |
|---|---|---|
| High | Pricing HTML: stale "coming soon" copy, no plans/prices without JS | Footer now "Monthly or yearly plans · secure payments by Stripe" (JS says "Paid plans coming soon · the Free plan is available today" only when payments are actually off); the four plans with prices, yearly prices, intro offer, allowances and what each adds are in the HTML, generated at build from the database migrations (scripts/seo.mjs) and replaced by the full cards. Verified against the production `billing_plans` table. |
| High | Home main-thread blocking (Lighthouse TBT 3.55 s) | The 3D mascot (Three.js + shader compile + frame loop) boots after load at the first interaction or after 6 s of quiet; still image on save-data / ≤2 GB devices. The transcription worker's GPU check (165 KB) waits for idle or first interaction. |
| Medium | No social preview image | 1200×630 `public/og-image.png` (scripts/og-image.mjs), `og:image` + size/alt, X `summary_large_image` on every indexable page; og tags filled from each page's own title/description/canonical |
| Medium | No structured data on Home/Pricing | JSON-LD `Organization` (SparkScribe, HRstudios LLC, logo, contact email), `WebSite`, `WebApplication` with 7 real offers (monthly + yearly). **No ratings/reviews** (none exist; inventing them is forbidden) — so not eligible for software rich results, by design |
| Medium | Legal pages noindex yet in sitemap | Final legal pages are indexable with canonicals (generator keeps drafts noindex) |
| Low | Private routes protected only by meta | `X-Robots-Tag: noindex` header on library/transcript/settings/account/across/auth and `/api/*` (vercel.json). Privacy itself is still enforced by auth + RLS, unchanged |
| Low | Titles not led by search intent | See §4 |
| Guard | — | `tests/seo-test.mjs` (in `npm test`): sitemap ↔ indexable pages ↔ one self-canonical each, unique titles, private pages noindex and absent from the sitemap, headers, robots, prices in the static summary / description / JSON-LD equal the migrations, no ratings |

Not changed: prices, Stripe, entitlements, usage limits, auth, CAPTCHA, RLS, transcripts, recordings, privacy text.

## 3. Performance (lab, Lighthouse 12.2.1 mobile, single runs — expect ±10 points of noise)

| Page | Before (production) | After (Preview) |
|---|---|---|
| Home | perf 39 · TBT 3,550 ms · LCP 5.3 s · FCP 4.4 s · 486 KB | perf **69** · TBT **140 ms** · LCP 4.9 s · FCP 4.0 s · **339 KB** |
| Pricing | 79 · TBT 60 ms · LCP 4.1 s | 78 · TBT 80 ms · LCP 4.0 s |
| Lecture notes | 87 · LCP 2.9 s | 84 · LCP 3.4 s (noise) |

CLS 0 everywhere. No field data yet (CrUX needs traffic; Search Console's Core Web Vitals report will show it once
verified). Remaining lab bottleneck: render-blocking CSS (385 KB raw / 74 KB gz, the legacy stylesheet plus Electric) and
the Google Fonts stylesheet. Next steps in §7.

## 4. Keyword → page map (volumes: **unknown** — no keyword tool with verified data was used; priorities are by relevance and SERP opportunity)

| Page | Primary intent | Secondary terms (naturally in the copy) | SERP today (2026-10-22) | Fit |
|---|---|---|---|---|
| `/lecture-notes` | lecture recording to notes | lecture audio to notes, AI lecture notes, convert lecture audio to text, lecture transcription | iOS app listings (LectureNotes AI, Transcriba, ThinkNote), Taskade convert templates | Strong: web, no install, grounded notes with timestamps |
| `/flashcards` | flashcards from lecture recordings | turn lecture into flashcards, AI flashcard generator from notes, spaced repetition | LectureScribe (iOS), RemNote/Fabric/Affine how-tos, Taskade | Strong: each card linked to its moment, spaced review |
| `/exam-prep` | study for exams with lecture recordings | AI exam preparation, organize lectures for exams, study plan from lecture notes | Mixed blogs | Medium: unique "exam date → plan from your lectures" |
| `/` | lecture recordings to study material (brand) | AI lecture notes, flashcards and quizzes, study tools for students | — | Brand + overview |
| `/pricing` | SparkScribe pricing | free lecture transcription plan, student study app price | — | Navigational |
| (new) `/practice-quiz` | quiz from lecture recording | practice questions from notes, quiz generator from lecture transcript | iWeaver, convertaudiototext, Taskade | Strong: questions with the passage, Focused Review on misses |
| (new) `/study-guide` | study guide from lecture | AI study guide generator, study guide from audio recording | template sites | Medium |

One intent per page; the new pages only if they get their own example output (not copies of `/lecture-notes`).

## 5. On-page (titles / descriptions / H1)

| Page | Title | Description | H1 |
|---|---|---|---|
| `/` | SparkScribe — AI lecture notes, flashcards and quizzes | Upload a class recording and get notes, flashcards, practice quizzes and a study guide built from what was said. Transcribed on your device. Free to start. | Turn your lectures into something you can actually study. (eyebrow now "AI study tools for lecture recordings") |
| `/pricing` | SparkScribe pricing — Free and paid study plans | (generated from the plans) SparkScribe plans: Free (30 min a month), Flash $5.99 ($1 first month), Bolt $9.99 with Focused Review, Thunder $14.99 across recordings. Monthly or yearly. | Pick the plan that fits your semester. |
| `/lecture-notes` | Turn lecture recordings into notes — SparkScribe | unchanged | Turn a lecture recording into notes you can study. |
| `/flashcards` | Make flashcards from lecture recordings — SparkScribe | unchanged | unchanged |
| `/exam-prep` | Study for exams with your lecture recordings — SparkScribe | unchanged | unchanged |
| `/help` | Help and FAQ — SparkScribe | unchanged | unchanged |

Internal linking was already good (every public page links to the others and to Pricing with descriptive anchors); left as is.

## 6. Search Console, Bing, analytics — owner steps

**Google Search Console (not set up):**
1. https://search.google.com/search-console → Add property → **Domain** → `spark-scribe.com`.
2. Copy the TXT record (`google-site-verification=…`) → add it at your DNS provider for `spark-scribe.com` (keep `v=spf1 -all`).
3. Verify, then Sitemaps → submit `https://www.spark-scribe.com/sitemap.xml`.
4. URL Inspection → request indexing for `/`, `/pricing`, `/lecture-notes`, `/flashcards`, `/exam-prep` after the release.
5. Watch: Pages (indexed / crawled-not-indexed), Performance (queries, CTR), Core Web Vitals, Enhancements.

**Bing Webmaster Tools:** https://www.bing.com/webmasters → **Import from Google Search Console** (fastest once GSC is
verified) or add the site with its DNS CNAME/TXT → submit the sitemap. IndexNow: possible later with a key file in
`public/` and a ping on deploy; not added now.

**Analytics:** none installed. Recommendation: a cookieless, aggregate tool (Vercel Web Analytics or Plausible) on public
pages only, with events: landing view, Upload-a-lecture click, sign-up start/complete, Pricing view, checkout start;
**purchase only from the server-side Stripe webhook state**, never from a success URL. Never send audio, transcript
text, notes, course names, tokens, payment data or emails. Needs your choice (and a privacy-policy line) before adding.

## 7. Roadmap

Content (drafts to be previewed before publishing; ranked by usefulness × likely impact):
1. **How to turn a recorded lecture into study notes** — the workflow, audio tips, checking against timestamps, limits.
2. **How to make flashcards from lecture recordings** — real example cards with their source moments; spaced review.
3. **Practice quiz from a lecture recording** (new page `/practice-quiz`) — sample questions with passages, Focused Review.
4. **How to prepare for an exam with your lecture recordings** — exam date, plan, missed questions, cross-lecture review.
5. **What makes a good lecture transcription** — microphone position, noise, names, speakers, proofreading.
6. **How to study a 60-minute lecture in 20 minutes** — summary → notes → active recall, honest about limits.
7. **How to organize recordings from several classes** — courses, naming, finding a moment later.
8. **Reviewing the questions you missed** — why targeted review works, without unsupported claims.

Technical next steps:
- Make the Google Fonts stylesheet non-render-blocking (or self-host Sora/Geist) and drop the legacy stylesheet from
  public pages → expected FCP/LCP gain on mobile; measure before/after.
- `lastmod` in the sitemap once page dates are tracked.
- Branded 404 page (status stays 404).
- After a month of Search Console data: rewrite titles/descriptions of pages with impressions but low CTR.

Sources consulted for the SERP snapshot: app-store and vendor pages returned by searches on 2026-10-22 (e.g.
taskade.com/convert/audio/lecture-to-notes, remnote.com/blog/how-to-turn-lectures-into-flashcards, fabric.so/for-your/flashcards,
iweaver.ai/agents/lecture-to-quiz). Their claims were not verified.
