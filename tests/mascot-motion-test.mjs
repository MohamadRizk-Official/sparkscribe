// Mascot pose maths (src/mascot/motion.js): channels, pose/mirror/lerpPose, smoothstep, support height.
import assert from 'node:assert/strict';
const M = await import(new URL('../src/mascot/motion.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const near = (a, b, e = 1e-5) => Math.abs(a - b) < e;

ok(M.CH.length === 28 && new Set(M.CH).size === 28, 'there are 28 distinct pose channels');
ok(M.CH.every((c, i) => M.K[c] === i), 'K maps every channel name to its index');
ok(M.REST.length === M.CH.length && near(M.REST[M.K.aLz], M.ARM) && near(M.REST[M.K.aRz], -M.ARM), 'the rest pose holds both arms out to the sides');
ok(M.REST[M.K.pitch] === 0 && M.REST[M.K.sy] === 0, 'every other rest channel is zero');

let p = M.pose({ pitch: 0.3, by: -0.1 });
ok(near(p[M.K.pitch], 0.3) && near(p[M.K.by], -0.1), 'pose() sets the named channels');
ok(near(p[M.K.aLz], M.ARM), 'pose() leaves unnamed channels at rest');
ok(M.REST[M.K.pitch] === 0, 'pose() does not modify the shared rest pose');
ok(M.pose().every((v, i) => v === M.REST[i]), 'pose() with no fields equals rest');

ok(M.ss(-1) === 0 && M.ss(0) === 0 && M.ss(1) === 1 && M.ss(2) === 1, 'smoothstep clamps to 0..1');
ok(near(M.ss(0.5), 0.5), 'smoothstep is 0.5 in the middle');
ok(M.ss(0.25) < 0.25 && M.ss(0.75) > 0.75, 'smoothstep eases in and out');

const q = M.pose({ aLz: 2, aRz: -1, aLx: 0.4, aRx: 0.1, roll: 0.2, twist: -0.3, sx: 0.5, fLy: 0.7, fRy: 0.1 });
const m = M.mirror(q);
ok(near(m[M.K.aLz], 1) && near(m[M.K.aRz], -2), 'mirror swaps the arms and flips their side');
ok(near(m[M.K.aLx], 0.1) && near(m[M.K.aRx], 0.4), 'mirror swaps forward/back swing without changing its sign');
ok(near(m[M.K.roll], -0.2) && near(m[M.K.twist], 0.3) && near(m[M.K.sx], -0.5), 'mirror negates roll, twist and screen offset');
ok(near(m[M.K.fLy], 0.1) && near(m[M.K.fRy], 0.7), 'mirror swaps the feet');
ok(M.mirror(M.mirror(q)).every((v, i) => near(v, q[i])), 'mirroring twice gives the original pose');
ok(q[M.K.roll] === 0.2 || near(q[M.K.roll], 0.2), 'mirror does not modify its input');

const out = new Float32Array(M.CH.length);
const a = M.pose({ by: 0 }), b = M.pose({ by: 1 });
ok(near(M.lerpPose(a, b, 0.25, out)[M.K.by], 0.25), 'lerpPose blends a quarter of the way');
ok(M.lerpPose(a, b, 0, out) === out && near(out[M.K.by], 0), 'lerpPose writes into and returns the output array');
ok(near(M.lerpPose(a, b, 1, out)[M.K.by], 1), 'lerpPose at 1 is the target pose');

ok(near(M.support(0), M.DIM.foot, 0.1), 'standing support is about the foot height');
ok(M.support(Math.PI / 2) > 0.5 && M.support(Math.PI / 2) < M.DIM.foot, 'lying on its side it sits lower than standing');
ok(M.support(Math.PI) >= M.DIM.top - 0.1, 'upside down it rests on the tip of the head piece');
ok(M.support(0.4) > 0 && M.support(-0.4) > 0, 'support height is positive at small tilts');

console.log(`${pass} checks passed`);
