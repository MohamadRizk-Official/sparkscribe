# 28 — Precision UI polish: depth, interactions, More tools, both themes (2026-10-22)

On top of 27 (Electric polish) and 3083ca8 (signed-out clean-up). No change to pricing, billing, auth, transcription
or saved recordings: CSS, the Create/Notes markup and the timeline labels only.

| Item | Root cause / what changed |
|---|---|
| More tools expanded on hover | Each row carried a hidden example that `:hover` turned into `display: grid`, growing the row and pushing the next one down. Removed from the rows (markup and CSS); rows keep their height (tested). Hover now lifts the row 2px, lights its surface, nudges the icon and moves the arrow. |
| Clipped arrows | The arrow was the older style's 30px bordered circle, placed in an 18px grid column of a row with `overflow: hidden`, so its right side was cut (arrow edge 1299px vs row edge 1294px). Now a 28px action area with no circle; the arrow moves 4px inside it; the row no longer clips. Test: every arrow + its hover move fits inside its row. |
| Recommended previews | Each is a miniature document: a title bar (tool colour, document name, "Example"), a page with real-looking content (recap: highlights / decisions / tasks / next steps; action plan: tasks with owners and dates; draft: To / Subject / body). Deep-blue page with cool edge light in dark, light page with graphite edge in light. Hover lifts the card and sharpens the page; nothing expands. On phones the card is one column (an older 720px rule put the icon beside everything). |
| Tab bar corners | All four corners 12px; one surface with the main-surface edge; the selected line stays crisp. |
| Surface hierarchy | New tokens (tokens.css) and one assignment file (surfaces.css): main working areas (transcript, speakers, timeline, study panels, More tools, settings/account cards, comparison table) get a lifted blue-charcoal body, one cool edge and a deep shadow in dark, and a white body with a graphite edge (rgba(15,23,42,.34)) and natural shadow in light; featured cards (recommended tools, plans) get more depth and a stronger hover; list items keep soft shadows. Buttons and inputs are untouched. |
| Timeline "line" | It is the playhead at 0:00 (main.js updatePlayhead; it moves during playback). It was drawn in near-black ink, so at rest it looked like a stray border. Now cyan with a round knob (both themes). Speaker labels: coloured dot + readable ink (cyan text on white was ~2:1). |
| Notes disclosure | The left column is a flex column; the AI disclosure sits at its bottom (`margin-top: auto`), aligned with the preview's bottom, ~100px from the button. |
| Notes button → preview | Hover/focus on "Make … notes": the preview rises 7px, its shadow grows, it brightens, one current runs down the section markers, the sections lift 2px one after another (45ms apart); it stays up while hovered and settles when the pointer leaves. No loop; off with reduced motion. |
| Thunder card | The inset 1px violet edge over a gradient is gone. Violet-graphite body lit from the top right, the neutral feature edge, a violet light cast beneath the card (offset, never a ring), a solid accent band on top; hover: the card rises, the light grows, one current runs along the band, the CTA brightens. Prices and benefits unchanged. |
| Dark background | A third static light: a soft blue-cyan pool behind the working column; a stronger key light; a vignette so the room's edges fall into shadow (circuit traces stay above it). |

Tests (QA harness, fresh starts): transcript 8/8, create 6/6 (new: no previews in More tools, arrow bounds, tab corners),
insights 3/3, home-save 8/8, transcript-layout, thunder 2/2, billing pricing 3/3, axe WCAG 2.1 AA 0 serious/critical on
all pages in both themes, no horizontal overflow at 360/375px, `npm test` and `vite build` pass. Checked visually at
1440 (dark, light), 768 and 375.

## Performance ("a bit laggy on my friend's computer")

Measured on production (3083ca8): the 3D mascot drew **128 frames a second while standing idle** on a 240 Hz display.
Its loop skipped every other display frame instead of capping by time, so a 144 Hz laptop got 72 fps idle / 144 fps
moving, with antialiasing at up to 2× pixel density. Around it, three live backdrop blurs (sticky tab bar, player bar,
scrolled header) were re-composited whenever something underneath changed, the header logo's SVG ignite ran forever,
and the background current animated a full-viewport layer with a mask and blur filters.

Fixes: the mascot steps at most ~60 times a second and draws at most 24 times a second while still (simulated 240 Hz:
20 draws/s), pixel density capped at 1.5; the tab bar, player bar, scrolled header and settings nav are solid surfaces
(no backdrop blur); the logo ignites three times after load, then rests; the background current has no mask or
filters. Nothing visible was removed.
