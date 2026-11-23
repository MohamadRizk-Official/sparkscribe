# Sound wave background (`src/electric/sound-wave.js`)

A field of glowing points shaped like a sound wave that runs across the whole page, behind everything. `mountSoundWave(bg)` is called once by `mountAmbient()` ([electric-chrome.md](electric-chrome.md)). It is plain WebGL, no library, and browser only, so it has no unit test.

## What it draws
- `STRANDS = 30` strands of `PER_STRAND = 1100` points: 33,000 points in all, each strand a slightly shifted copy of one waveform, so together they read as one ribbon of light. Where strands cross the light adds up.
- Everything is computed in the vertex shader from time and a few uniforms (shape, drift, pointer push, click rings, spawn-in), so the processor does almost nothing per frame.
- The points drift slowly to the right for ever.
- When the page opens, and again after a theme switch (`sparkscribe:theme` event), the wave **spawns in**: points drift in from a little to the left, staggered, over `SPAWN_MS = 1600` ms.

## Interaction
- The pointer stirs the points it passes over (touch pointers are ignored).
- A click on the page itself sends a ripple outward: points the ring crosses are thrown outward, scatter a little, then settle back. Up to `TAPS = 6` ripples are live at once, each lasting four seconds.
- Clicks on controls do **not** ripple: links, buttons, inputs, textareas, selects, labels, summaries, video, audio, `[role=button]`, dialogs and contenteditable areas are skipped, as are non-primary mouse buttons.

## When it rests
It draws no frames (the loop stops and restarts when the condition ends) in any of these cases:
| condition | why |
|---|---|
| the tab is hidden | nothing to see |
| the page has class `bg-working` | a recording is being transcribed and the GPU is busy |
| the screen is narrower than 900 px | the canvas is hidden |

With reduced motion the wave is drawn as **one still frame**, with no ripples.

## Failure handling
- No WebGL context: the canvas is removed and nothing else happens.
- `webglcontextlost`: the loop is cancelled and the canvas removed.
- Pixel ratio is capped at 1.5 so high-density screens do not pay for points nobody can tell apart. The point size is slightly larger in the light theme (3.6) than the dark (3.2).
- It only mounts once: an existing `.bg-wave` in the background stops a second one being added.
