# Page chrome (`src/electric/chrome.js`)

Shared by every page. `mountAccountMenu` in `src/lib/account.js` calls `mountAmbient()` and `mountHeaderState()` on load and `mountNavIndicator(nav)` for the main nav. Everything here is decoration over real controls: `aria-hidden`, no layout shift, transforms only, and reduced motion keeps the static parts. Browser only, so there is no unit test.

## `mountAmbient()`
- Finds `body > .bg`, or creates it (`aria-hidden`, prepended to `body`) with two light sources (`bg-glow-a`, `bg-glow-b`) and a noise layer.
- Loads `sound-wave.js` afterwards (a dynamic import, so it never delays the page). If the import fails, the error is swallowed and the page simply has no wave.
- The faint circuit (right-angled SVG traces near the edges of a 1440 x 900 room, with a slow current running along one at a time) is **switched off**: `NO_CIRCUIT = true`, because the background is one solid colour now (`edges.css`). The `TRACES`, `NODES` and `runCurrents` code remain, but `mountAmbient` returns before drawing them. Calling it twice does nothing extra: the existing `.bg` is reused.

## `mountHeaderState()`
Marks the `.topbar` once (`data-e-state`) and toggles the class `is-scrolled` when the page has scrolled more than 8 px, so a sticky header gains depth. The scroll handler is passive and throttled with one `requestAnimationFrame` at a time.

## `mountNavIndicator(nav)`
One indicator per nav: a `span.nav-indicator` appended to `.nav-links`.
- It rests under the link marked `aria-current="page"`.
- Pointing at, or focusing, another link glides it there; leaving the nav (or focus leaving it) returns it.
- It is placed with `transform` and `width` only, reading layout on hover and resize rather than on every frame. Its width is the link's width minus 24 px (at least 16 px), shifted 12 px in.
- Hidden (`opacity: 0`) when `.nav-links` is laid out as a column, as in the mobile menu.
- Re-placed instantly (transition disabled for one frame) on window resize and when web fonts finish loading, because font loading changes link widths.
