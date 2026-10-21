# 26 — Electric: the SparkScribe redesign (branch `design/electric`, Preview only)

Preview: https://sparkscribe-git-design-electric-moerizz.vercel.app (Production is unchanged until approved).

## Diagnosis: the root causes, not a list of symptoms
1. **One surface for everything.** Navy rectangle + thin glowing border + small icon + small label was used for recordings,
   plans, banners, menus and tools alike, so nothing had a role and everything had the same weight.
2. **Outlines and pills did the work typography and depth should do.** Hierarchy came from borders and capsules
   ("YOUR PERSONAL ARCHIVE", "SAVE 17%+", six metadata pills), not from type, spacing and elevation.
3. **Flows asked twice.** Create needed a tile click and then a "Create X" click; rename was a dialog; adding recordings
   to a course meant opening each recording's menu; playback speed cycled silently.
4. **The order fought the job.** On the signed-in home the upload card came after four other sections.
5. **Light was fog.** Large blurred gradients everywhere instead of a few deliberate light sources.

## The system (src/app.css → src/electric/*)
- **Architecture:** the previous stylesheet lives in a `legacy` cascade layer, the new system in `electric` above it, so a
  component is restyled by one rule without specificity fights, and anything not yet restyled still works.
- **Type:** Sora (display, wordmark), Geist (interface and reading), Geist Mono (timestamps only).
- **Palette:** dark graphite `#07111B` with cyan `#20D4F4` → cobalt `#4A7BFF` as the brand current, violet for depth,
  amber for ignition, magenta sparingly; light mode is its own pearl canvas, not an inversion. All text tokens pass WCAG AA.
- **Surfaces by role:** canvas, workspace, raised, featured, floating, utility; elevation (ambient + key shadow + lit top
  edge) instead of outlines. Borders remain only for inputs, selection and tight grouping.
- **Motion:** press 120 ms, hover 200 ms, menus 180 ms, tabs 240 ms, panels 300 ms, theme 560 ms; transforms and opacity
  only; everything respects reduced motion. Achievement moments (saved, stage done) are short and only on real events.
- **Electricity as a language:** one charged line marks the current page and tab; the upload card's perimeter lights only
  while a file is dragged over it; the transcription rail lights as real stages finish; the plans each have one effect
  (Flash ignites, Bolt's current runs, Thunder's arcs connect), on hover only.

## Research → what was borrowed (and where)
| Source | Pattern | Problem it solves | Where |
|---|---|---|---|
| Linear | Quiet chrome, one accent for "you are here" | Weak active navigation | Header nav indicator, workspace tabs |
| Linear | Dense rows that stay scannable | Huge repeated recording boxes | Library recording rows |
| Raycast | One prominent primary action, others quieter | Many equal buttons | Header "New recording", workspace toolbar |
| Raycast | Keyboard-first search ("/" focuses) | Search felt secondary | Library search with `/` hint |
| Spotify | Row hover reveals actions; whole row is the target | Tiny click targets, hidden actions | Library rows, Create rows |
| Notion | Inline editing of titles (double-click, Enter/Escape) | Rename needed a dialog | Library rows, recording title |
| Figma | Clear selected vs hover states | Hover and selection looked alike | Selecting recordings, segmented controls |
| Duolingo | Immediate feedback, one clear next action, review what you missed | Flat empty states, unclear next step | "Up next", empty states, star feedback |
| Baymard SaaS plan matrix | Compare features in a scannable matrix with anchored headers | Small, hard-to-read comparison | Pricing comparison table |
| Baymard | Clarity over urgency; no unverifiable claims | "Popular", one % for all plans | Pricing descriptors, exact yearly savings |
| Apple HIG / Material motion | Short, purposeful motion; never block input | Decorative or slow animation | Motion tokens, reduced-motion rules |
| NN/g animation purpose | Animate state changes, not decoration | Constant pulsing | Effects only on hover/real events |

## What changed, screen by screen
- **Header:** Home · Library · Courses · Pricing with one electric indicator; New recording; tactile theme dial; account
  menu trimmed to plan & usage, Settings, Help, Sign out (Library is in the nav).
- **Home (signed in):** greeting → upload card → Resume / Up next → Recent recordings / Courses. Up next shows only
  suggestions backed by saved data.
- **Library:** "Your Library" + plain stats; search with "/"; text tabs; a type filter whose counts appear only when they
  describe the list (never inside a course); new rows with inline rename and star feedback; warmer empty states.
- **Courses:** breadcrumb, accent colour, the course's own count, **Add recordings** (search + multi-select) from inside the
  course, "Upload a lecture" from an empty course; a new course opens straight away.
- **Processing:** a workspace panel; stages joined by a rail that lights as real stages finish; the current one pulses; a
  current runs only along real progress.
- **Recording workspace:** document title (inline rename), one metadata line, the type control restored (it was wiped
  when the header redrew), toolbar hierarchy with Delete in More, sticky text tabs, a reading-width transcript, a compact
  "Saved" status instead of a banner.
- **Player:** one transport for both players, speed opens a selector, playing indicator tied to real playback, the
  mascot stands on/right of the player and never covers it.
- **Summary / Notes / Ask / Create:** "The short version" as a document lead, key points as a numbered list with small play
  links, chapters as a timeline; Notes shows what the notebook will contain before it's made; Ask has student starters
  and a clear "ask across recordings" (Thunder, up to 12); Create shows recommended tools with a labelled example of
  their output, every other tool once as a compact row, and starts a tool on one click when no input is needed.
- **Pricing:** four personalities, honest descriptors (no "most popular"), Monthly/Yearly segmented control with exact
  savings in words, Thunder's cross-recording value shown concretely, "Which plan fits your semester?" instead of the
  "Bolt = 3× Flash" section, a comparison matrix without the ratio row, "Every plan includes" as a four-step flow, a
  lighter FAQ. Prices, allowances, Stripe and checkout code are unchanged.
- **Settings / Plan & billing:** section rail with scroll-spy, calm panels, Appearance uses the same circular reveal,
  "Privacy & data"; Plan & billing named consistently.

## Tests (all run on this branch)
- `npm test` 33/33; `npm run test:sql` 13 suites pass; `npm run build` ok.
- Browser e2e in the QA harness (mock data, mock AI, fresh harness per suite): library 7, transcript 8, insights 3,
  create 6, export 4, study 7, srs 7 + home 1, home-save 8, a11y 4, security 4, legal 2, save-retry 2, appearance 5,
  billing 3 + 1 + 4, exam 7, auth 13, recovery 22, ai-limits 5, focus-review 3 + 4 + gate 2, across 19,
  yearly 5 + 1 + 2 + 1, pending-privacy 7, account-deletion 5 + 1, captcha 16 + 2 — all passing.
- axe-core (WCAG 2.1 A/AA) on every page in light and dark: 0 serious/critical violations.
- Phone width (375 px): no horizontal overflow on any page.
- Tests changed only where behaviour changed on purpose (inline rename, one-click Create, exact savings, theme reveal,
  the asynchronous flashcard schedule save).

## Not verified here (needs the owner)
- Real sign-in on the Preview with a real account (the harness uses a mock user).
- Real transcription speed on a phone (the harness uses a fake worker; the processing screen was checked with a staged
  state and the fresh result with the fake worker).
- Live payments on Preview are off by design (Preview shows "coming soon").

## Release and rollback
- No database, API, Stripe or auth changes. Releasing = fast-forward `main` to `design/electric` (Vercel deploys).
- Rollback: Vercel Instant Rollback to the current Production deployment, or revert `main` to `78ccf9b`.
