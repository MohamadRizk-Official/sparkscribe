# Small UI widgets (`theme-toggle.js`, `details-pop.js`, `brand.js`)

Three small browser-only modules in `src/lib/`. They touch `document` and `window`, so they are not unit tested under
plain Node (see [../TESTING.md](../TESTING.md)); this guide records what they promise.

## `src/lib/theme-toggle.js`: the Light / Dark button
- `mountThemeToggle(anchor)` adds one `button.theme-btn` to the top bar, just before `anchor` (the account slot) when
  it sits in the same row, otherwise at the end of the bar. The bar is `anchor.parentElement`, falling back to
  `.topbar-right`. Mounting twice does nothing (it returns `null` if a `.theme-btn` is already there).
- The button shows a sun in dark mode and a moon in light mode, and its `aria-label` / `title` say what the click
  will do ("Switch to light mode" / "Switch to dark mode"). It repaints on the `sparkscribe:theme` window event, so it
  stays right when the theme changes from Settings, another tab, or the device setting while on "System".
- It also sets `<meta name="theme-color">` (the phone address-bar colour): `#04050d` in dark, the page's own
  background in light.
- A click calls `switchTheme(btn, 'light' | 'dark')`, which saves through `setThemePref` in `src/lib/prefs.js`
  (local storage always, the account too when signed in). The source of truth for the appearance is `src/lib/theme.js`;
  this file never decides the theme itself.
- **Circle transition:** when the browser supports View Transitions, the new theme grows as a circle from the button
  (560 ms). It is skipped, and the theme is applied at once, when the resolved theme would not change, the browser has
  no `startViewTransition`, the person prefers reduced motion, or the page is not visible. If a transition has not
  started after 300 ms (a page that is not painting frames) the theme is applied anyway.

## `src/lib/details-pop.js`: the "Details" panel
- `toggleDetails(anchor, title, rows)` opens a small `role="dialog"` panel next to `anchor`; calling it again with the
  same anchor closes it. Only one panel is open at a time.
- `rows` is `[[label, value, note?]]`. Falsy entries are skipped, so callers can write `cond && [...]`. All text goes
  through `esc()` (from `src/lib/account.js`), so labels and values are never interpreted as HTML.
- Position: left edge aligned with the anchor but kept 12 px inside the viewport; below the anchor, or above it when it
  would not fit.
- Closes on Escape (focus returns to the anchor), a pointer press outside the panel and anchor, a click on the anchor,
  or any scroll. `aria-expanded` on the anchor follows the state.

## `src/lib/brand.js`: the logo pulse
- `sparkPulse(root = document)` restarts the one-off logo animation: every `.spark-mark` under `root` gets the class
  `is-sparking`, removed again when the last animation (`sp-light-o`) ends. The class is deliberately not `pulse`,
  which is the site-wide status dot.
- It is all CSS animation, so the reduce-motion rules in `style.css` switch it off. The markup itself comes from
  `src/lib/brand-markup.js` (covered by `tests/brand-markup-test.mjs`).
