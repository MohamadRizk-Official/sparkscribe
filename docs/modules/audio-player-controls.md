# Audio player controls (`src/electric/transport.js`, `src/electric/speed-menu.js`)

The player under a transcript. `mountTransport` is used by the saved-recording page (`src/pages/transcript.js`); the
player under a fresh transcript (`src/main.js`) has the same controls and look. Both attach the speed selector. They
need a browser (`document`, an `<audio>` element), so only the constants are unit-tested
(`tests/electric-helpers-test.mjs` covers `SPEED_OPTIONS`).

## `mountTransport(root, audio, { duration })`
The markup is found by role, not id: inside `root`, elements with `data-pb="play" | "back" | "fwd" | "seek" | "time" |
"mute" | "vol" | "speed"`. `vol` and `speed` are optional; the others must exist. `duration` is a function used while
the audio element does not know its length yet (`audio.duration` is `NaN` or 0 until metadata loads). Returns
`{ paint }` to force a redraw.

| control | behaviour |
|---|---|
| play | toggles play/pause; label and tooltip say what the next click does ("Pause (space)" / "Play (space)"); `root` gets `is-playing` |
| back / fwd | jump −10 s / +10 s, clamped between 0 and the duration |
| seek | a range of 0–1000; dragging sets `currentTime` to that fraction of the duration. While the slider has focus it is not moved by playback, so dragging is not fought; `--fill` and `aria-valuetext` ("0:12 of 3:45") follow the time |
| time | "m:ss / m:ss", or "h:mm:ss" from one hour |
| mute | mutes; if the audio is muted or at volume 0, unmutes (and sets the volume to 50 % if it was 0). Icon: muted / low (< 50 %) / high |
| vol | 0–100; setting it to 0 also mutes |
| speed | the speed selector below |

Redraws happen on `timeupdate`, `loadedmetadata`, `durationchange` and `seeked` (time), `play`, `pause`, `ended`
(play button) and `volumechange` (volume).

### Keyboard (document-wide while the player is visible)
Space plays/pauses, ←/→ jump 5 s, **M** mutes. They are ignored when Ctrl, Cmd or Alt is held, while a `<dialog>` is
open, while `root` has the `hidden` class, and when focus is in a text field, select, button, link, `summary`,
editable element, menu item or tab, so typing and normal keyboard navigation are never hijacked.

## `attachSpeedMenu(button, audio, { onChange })`
- `SPEED_OPTIONS` = 0.75, 1, 1.25, 1.5, 1.75, 2. The button shows the current rate ("1×") and has
  `aria-haspopup="menu"` and `aria-expanded`.
- Clicking opens a small `role="menu"` of `menuitemradio` entries (the current speed has `aria-checked="true"`, 1× is
  labelled "Normal"). The click is `stopImmediatePropagation`-ed so other handlers on the button do not also run.
- The menu appears above the button (players sit at the bottom of the screen), kept 8 px inside the viewport, or
  below it when there is no room above.
- Picking a speed sets `audio.playbackRate`, repaints the button, calls `onChange(rate)` and returns focus to the button.
- Keyboard: ↓/→ and ↑/← move (wrapping), Enter/Space pick, Escape or Tab closes and returns focus. It also closes on a
  press outside the menu and on any scroll. The button follows `ratechange`, so a speed changed elsewhere is shown.
- Returns `{ close }`.
