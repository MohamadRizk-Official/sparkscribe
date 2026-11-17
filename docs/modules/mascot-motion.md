# Mascot motion (`src/mascot/motion.js`)

Pure animation maths for the mascot, with no DOM or WebGL, so it runs under plain Node. Covered by
`tests/mascot-motion-test.mjs` and `tests/mascot-animator-test.mjs`. The 3D model that uses it is `src/mascot/model.js`.

## Poses
A pose is a `Float32Array` with one number per channel; `CH` lists the 28 channel names and `K` maps a name to its index
(`K.pitch`, `K.aLz`, ...). Channels cover the whole-character screen offset and roll (`sx sy sr`), body offset (`bx by bz`),
squash (`sq`), lean/tilt/turn (`pitch roll twist`), both shoulders, hips, feet, gem tilt and an authored eye direction.
Units are radians and body units, with the body radius as 1.

- `REST`: every channel 0 except both arms held out to the sides (`aLz = ARM`, `aRz = -ARM`).
- `pose(fields)`: a copy of `REST` with the named channels set. It never changes `REST`.
- `mirror(p)`: left/right swap. Arms, hips and feet are exchanged (z-rotations change sign), and `sx sr bx roll twist eyeX gemT` are negated. Mirroring twice gives the original.
- `lerpPose(a, b, t, out)`: channel-wise blend written into `out`, which is returned.
- `ss(v)`: smoothstep on a value clamped to 0..1.
- `support(theta)`: distance from the body centre down to the floor when the character is rolled by `theta`, taken from a fixed silhouette (body ellipse, feet, gem, head piece). It is about the standing foot height at 0 and larger when upside down.

## Clips
`CLIPS` holds keyframed one-shot moves (`hop`, `wave`, `cheer`, `dance`, `celebrate`, `nod`, `getUp`, ...). Between keys
`sampleClip(clip, t, out)` uses cubic Hermite curves; a tangent is zero at the first and last key and wherever the
neighbouring slopes change direction, which keeps most extremes from overshooting (small overshoot on rising runs is
possible: the `hop` height peaks at about 0.605 although its highest key is 0.6). Before the first key and after the last
it returns that key. A few clips come as a function of side (`sideClip`), returning a mirrored copy for side `-1`.

## Cycles
`CYCLES` are looping procedural bases: `idle gait climb hang slide sit held air fallen sad think working excited perch`.
Each is `fn(t, prm, out)` and adds to `out` (already set to `REST`). `climbRise(phase)` gives the wall height reached at a
climbing phase: two steps per whole cycle, never going down.

## `Animator`
One looping base plus at most one clip on top.

- `setBase(name, prm, fadeDur = 0.35)` crossfades to another cycle. Setting the current base again only merges `prm` into the existing parameter object, so a caller can keep steering it.
- `play(clip, { fadeIn, fadeOut, speed, onEnd })` returns a promise: `true` when the clip finishes, `false` when it is replaced by another clip or released. `onEnd` runs in the frame the clip ends, before that frame's pose is computed.
- `release(fadeOut)` lets go of the clip and blends from the current pose back to the base.
- `playing` is true only until the clip has ended; the clip object stays through its fade-out and is then cleared.
- `update(dt)` advances time and returns the output pose (the same array each time).
