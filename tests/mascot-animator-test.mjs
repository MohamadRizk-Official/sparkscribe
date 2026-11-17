// Mascot clips and animator (src/mascot/motion.js): sampleClip, climbRise, CYCLES, Animator base/clip handling.
import assert from 'node:assert/strict';
const M = await import(new URL('../src/mascot/motion.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const near = (a, b, e = 1e-4) => Math.abs(a - b) < e;
const N = M.CH.length;

// ---- climbRise: each cycle pulls twice ----
ok(M.climbRise(0) === 0, 'climbing starts at height 0');
ok(near(M.climbRise(1), 2) && near(M.climbRise(2), 4), 'every whole cycle climbs two steps');
let prev = -1, mono = true;
for (let i = 0; i <= 200; i++) { const v = M.climbRise(i / 50); if (v < prev - 1e-9) mono = false; prev = v; }
ok(mono, 'the climb never goes down');

// ---- sampleClip ----
const hop = M.CLIPS.hop;
const out = new Float32Array(N);
ok(hop.dur === hop.keys.at(-1).t, 'a clip lasts until its last key');
M.sampleClip(hop, -1, out);
ok(out.every((v, i) => v === hop.keys[0].p[i]), 'before the start it is the first key');
M.sampleClip(hop, 99, out);
ok(out.every((v, i) => v === hop.keys.at(-1).p[i]), 'after the end it is the last key');
M.sampleClip(hop, 0.3, out);
ok(near(out[M.K.sy], 0.55), 'at a key time it hits the key value exactly');
let lo = Infinity, hi = -Infinity;
for (let t = 0; t <= hop.dur; t += 0.01) { M.sampleClip(hop, t, out); lo = Math.min(lo, out[M.K.sy]); hi = Math.max(hi, out[M.K.sy]); }
ok(lo >= -1e-6 && hi < 0.65, 'the jump height stays close to its highest key (0.6) and never dips below the start');

// ---- cycles ----
ok(Object.keys(M.CYCLES).length === 14 && Object.values(M.CYCLES).every((f) => typeof f === 'function'), 'there are 14 base cycles');
for (const [name, fn] of Object.entries(M.CYCLES)) {
  const o = M.REST.slice();
  fn(1.23, { phase: 0.3, speed: 1, side: 1, run: 0 }, o);
  assert.ok(o.every(Number.isFinite), name);
}
ok(true, 'every cycle produces only finite numbers');

// ---- Animator ----
const an = new M.Animator();
ok(an.baseName === 'idle' && !an.playing, 'a new animator idles with no clip');
ok(an.update(0.016).length === N, 'update returns a full pose');
an.setBase('gait', { phase: 0 }, 0.2);
ok(an.baseName === 'gait', 'setBase switches the base cycle');
const prm = an.base.prm;
an.setBase('gait', { phase: 0.5 });
ok(an.base.prm === prm && prm.phase === 0.5, 'setting the same base again only updates its parameters');
for (let i = 0; i < 40; i++) an.update(0.016);
ok(an.fade === 1, 'the crossfade between bases finishes');

let ended = false;
const p = an.play(hop, { onEnd: () => { ended = true; } });
ok(an.playing, 'play starts a clip');
let steps = 0;
while (an.playing && steps++ < 1000) an.update(0.016);
ok(ended, 'onEnd runs when the clip ends');
ok(!an.playing, 'playing is false as soon as the clip has ended');
for (let i = 0; i < 40; i++) an.update(0.016);
ok(an.clip === null, 'the clip is dropped once its fade-out is done');
ok(await p === true, 'the play promise resolves true on a normal finish');

const first = an.play(hop);
const second = an.play(M.CLIPS.wave);
ok(await first === false, 'starting another clip resolves the interrupted one false');
an.update(0.016);
an.release(0.1);
ok(!an.playing, 'release lets go of the clip');
ok(await second === false, 'releasing resolves the clip false');
for (let i = 0; i < 20; i++) an.update(0.016);
ok(an.clip === null, 'after the release fade the clip is gone');

console.log(`${pass} checks passed`);
