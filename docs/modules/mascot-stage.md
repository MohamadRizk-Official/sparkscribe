# Mascot stage (`src/mascot/stage.js`)

The renderer behind the SparkScribe mascot: it draws the 3D character (`buildMascot()` in `src/mascot/model.js`) into **one small transparent canvas** that travels around the page with the character. It is loaded on demand with a dynamic `import('./stage.js')` by `src/mascot/mascot.js` after the page is ready, so Three.js is not part of the first load. If `createStage` throws (no WebGL, blocked GPU) or the import fails, `mascot.js` falls back to a still image (`/mascot/full.webp`) and the page works without it. Motion itself (what pose to show, when) lives in [mascot-motion.md](mascot-motion.md); the stage only turns a pose into joint rotations and renders.

## `createStage(canvas)` returns
| member | what it does |
|---|---|
| `m` | the mascot rig from `buildMascot()` (also used for `m.expr.setEye` and `m.update`) |
| `resize(px, dpr)` | sets the pixel ratio and makes the canvas `px × px` (square; CSS size is left alone) |
| `apply(P, yaw, roll)` | pose array `P` (indexed by the `K` names of `motion.js`) → joint rotations and positions |
| `lookDir(dx, dy, depth = 4)` | where the speaker "eye" should sit to look at a point |
| `render(dt)` | advances the model (`m.update(dt)`) and draws a frame, remembering the time |
| `lastRender` | `performance.now()` of the last draw (getter) |
| `dispose()` | frees the model, the environment map and the renderer |

## Scene
- Renderer: transparent (`alpha`, clear colour alpha 0), antialiased, `powerPreference: 'low-power'` so it doesn't wake a discrete GPU.
- Lighting: a generated "room" environment map (PMREM, released after use), an ambient light, a hemisphere light, a cool key light from the upper right, a pink fill from the left and a cyan rim from behind.
- Camera: a long-lens perspective camera (22° field of view) slightly raised (0.09 rad). It is placed so that `VIEW = 4.6` body units span the canvas, which keeps screen positions almost orthographic while still giving real perspective when the character turns.

## `apply`
Order matters and is fixed: screen roll (`spin`), facing (`yaw`), body position and rotation, squash and stretch on the torso (scaling the torso and shifting it down so the feet stay put), both arms, both legs, then foot height and pitch (`FOOT_Y` plus the pose offset), and the bolt's pivot.

The arms are floating crystals, so after each arm is rotated `reach()` pushes its mesh further from the shoulder the higher it points (a smooth-step between 0.3 and 0.92 units below the shoulder). Raised arms (cheering, climbing) therefore clear the round body.

## `lookDir`
Takes a screen offset in body units from the body centre (y up) and a depth in front of the screen where the viewer is. It converts that point into the speaker's local space and returns two eye offsets scaled by 1.9. If the point is behind the character (local z below 0.15) the vector is normalised so the eye looks as far as it can toward it instead of snapping to the middle.

Browser-only (needs WebGL): no automated test. The pose maths and animator it is fed from are tested in `tests/mascot-motion-test.mjs` and `tests/mascot-animator-test.mjs`.
