# 27 — Electric polish and UX fixes (2026-10-22)

Branch `design/polish` (from production `553bab5`). A targeted pass on the live Electric redesign: nothing in it was
reverted or replaced. **Not on Production**: it goes live only after the owner approves the Preview.

No change to Stripe keys, products, prices, webhooks, subscription records, usage or AI budget limits, renewal logic,
the Billing Portal configuration, Supabase Auth, CAPTCHA, RLS, password recovery, saved transcripts, recording
ownership, privacy disclosures or account deletion. No database or server changes: every fix is in the browser code.

## Fixes and root causes

| # | Issue | Root cause | Fix |
|---|---|---|---|
| P1 | Transcript squeezed into a narrow column | `process.css` (electric layer) set `.res-body` to `280px 1fr` for every result. Layers beat specificity, so it overrode the legacy `.results.solo` rule that drops the column when the speakers sidebar is hidden (one speaker). The transcript went into the empty 280px column. | The sidebar column exists only while the sidebar is shown (`.results.solo:not(.solo-open)` or no visible `.speakers-card` → one column). Reading measure 76ch → 88ch. |
| P2 | Background current crawled and faded half-way | One dash pattern 1490 units long on ~400-unit traces: the light was visible for ~27% of a 9 s cycle, moving slowly, and faded mid-path. | `runCurrents` (chrome.js): one trace at a time, `pathLength=100`, duration from the measured length (450–800 ms), accelerating, a flash at the node, then a 2.6–5.2 s rest. Off with reduced motion, in hidden tabs and on phones. |
| P3 | Flash users could open Ask across recordings and got "Choose recordings" with no word about Thunder | The Ask-panel link and the Library button ignored the plan; `/across` showed its Thunder panel only after 2+ recordings were selected. (The server was already correct: `requireCapability` refuses `across_ask` / `across_guide` with 403 `plan_required`, fail-closed.) | Shared `electric/thunder.js`: on another plan, Ask and Library open an explanation with one example and **Explore Thunder** → `/pricing?highlight=thunder&next=…`. `/across` shows the Thunder panel whatever is selected. Single-recording Ask is unchanged. New `highlight` parameter: highlights and scrolls to the card and **never** starts checkout. A violet bolt mark gets a short current on hover only. |
| P4 | Workspace tabs: square strip | — | Rounded top corners (12px), surface tint, indicator still aligned (measured: tab left = indicator left). |
| P5 | Canceled subscription: muddy amber banner; "Switch to Thunder" still offered | Banner styled as a warning; the switch button didn't check `cancelAtPeriodEnd`, and Stripe documents no behaviour for a `subscription_update_confirm` portal flow on a subscription set to cancel. | Neutral blue-graphite / blue-gray notice, calendar icon, title "{Plan} ends {date}", allowance and features kept, then Free, all from the billing status. While a cancellation is pending the page offers Manage Billing (where it can be kept or changed), not a direct switch. Nothing writes billing state. |
| P6 | Pulses were thin 1px rings | `e-ring` scaled a 1px outline. | Library empty states: a saturated core (lit tile, icon glow) and a filled halo that swells to 12px beyond the tile and dissipates (never reaches the heading, 20px away). /across eyebrow dot: violet core, 6px halo. No new pulses. |
| P7 | Notes empty state sat low; weak action | `align-items: center` and padding. | Heading at the top, larger "Make meeting notes" / "Make lecture notes" button with icon, AI disclosure after it in small print, refined preview. |
| P8 | Ask suggestions: thin cyan ring on hover | — | Raised surface and shadow on hover, arrow moves 3px, pressed state settles, the one just sent stays lit while the others wait, global focus ring. Still sends at once. |
| P9 | "The recording didn't support good questions with these settings." | A quiz is saved with zero questions when every written question fails the checks (`validateQuiz`, the verify pass) or the study map selects no concept. | A quality notice whose reason comes from the saved `quality` counts: no concept selected → "Not enough material for a reliable quiz" (links to Summary / Ask); strict format with `wrong_type` drops → "Use mixed formats"; verification couldn't run → "Try again". Retrying with the same settings is no longer offered where it would fail the same way (and use AI allowance again). |
| P10 | Pricing: list touching its separator | Legacy `.pz-list` border-top stayed, the electric rule set `padding: 0`. | 16px below one hairline on every card (measured 17px to the first item). |
| P11 | Pricing copy | — | One progression: Flash makes each lecture useful, Bolt keeps up weekly and fixes what you miss, Thunder connects lectures; a "Best for" line; Bolt shows "3× Flash's transcription time" (from the allowances). Prices unchanged, from `billing_plans`. |
| P12 | Waveform clipped / soft | `drawWave` drew 96px but the electric CSS shows 112px (stretched), the lit copy stayed 96px (misaligned), bars ran into the rounded edges, no redraw on resize. | Drawn at the real size × devicePixelRatio, 14px padding, 3px rounded bars, vivid cyan read part with glow, calm unread part; the reveal is mapped onto the padded bar area from real progress; redrawn on resize. |
| P13 | Gradient outlines / leaks | The legacy Flash card's animated gradient border (mask, padding, `pz-sheen`) still applied to the electric card glow pseudo-element. | Reset. `qa/e2e/decor-audit.js` lists masked outlines, border-images and endless animations on a page: none left on the touched pages except the logo's idle motion. |

## Tests (2026-10-22, QA harness)

New: `thunder.e2e.js` (Ask upsell, empty /across, Pricing highlight, Thunder path, paid-build no-checkout, cancel
notice — 8/8), `transcript-layout.e2e.js` (fresh one/several speakers, saved, 375–1920px).
Regression: transcript 8/8, insights 3/3, create 6/6, export 4/4, study 7/7, focus-review 9/9, across 20/20 (updated for
the new Library behaviour; direct API refused 403 for Free), billing 8/8, yearly 9/9, library 7/7, home-save 8/8,
ai-limits 5/5, a11y 4/4, security 4/4, layout at 375px (no overflow), axe WCAG 2.1 AA: 0 serious/critical on all pages
in both themes plus the new states (quiz notice, Thunder dialog, Ask, Notes, cancel notice, /across locked). `npm test`
passes; `vite build` passes.

## Limitations

- The background current was verified by stepping its animation timeline; a real-time recording isn't attached.
- Plan names in the Thunder explanation come from the billing status; signed-out visitors on /across are sent to sign in
  first (unchanged).
- "Keep Bolt or change plans in Manage Billing" relies on Stripe's portal offering renewal for a subscription set to
  cancel (standard portal behaviour); not exercised with a real subscription during this pass.
