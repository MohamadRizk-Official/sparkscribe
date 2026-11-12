// Speech-energy helpers in src/engine/diarize.js: frameEnergy, energyRuns, subtract.
import assert from 'node:assert/strict';
const D = await import(new URL('../src/engine/diarize.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const near = (a, b) => Math.abs(a - b) < 1e-6;

ok(D.SR === 16000 && D.UNKNOWN === 'Unknown' && D.MIN_GAP_SPEECH_S === 1, 'exported constants');

// ---- frameEnergy: RMS per 100 ms (1600 samples) ----
ok(D.frameEnergy(new Float32Array(0)).length === 0, 'empty audio gives no frames');
ok(D.frameEnergy(new Float32Array(1599)).length === 0, 'less than one frame gives no frames');
const loud = new Float32Array(3300).fill(0.5);
const e = D.frameEnergy(loud);
ok(e.length === 2, 'a trailing partial frame is dropped');
ok(near(e[0], 0.5) && near(e[1], 0.5), 'RMS of a constant signal is its amplitude');
const alt = Float32Array.from({ length: 1600 }, (_, i) => (i % 2 ? 0.25 : -0.25));
ok(near(D.frameEnergy(alt)[0], 0.25), 'RMS ignores sign');
ok(D.frameEnergy(new Float32Array(1600))[0] === 0, 'silence is zero');

// ---- energyRuns: runs of frames above a threshold ----
const frames = (spec) => Float32Array.from(spec.flatMap(([v, n]) => Array(n).fill(v)));
ok(D.energyRuns(new Float32Array(0)).length === 0, 'no frames gives no runs');
ok(D.energyRuns(frames([[0.001, 50]])).length === 0, 'constant quiet gives no runs');
let runs = D.energyRuns(frames([[0.001, 10], [0.1, 20], [0.001, 20]]));
ok(runs.length === 1 && near(runs[0].start, 1) && near(runs[0].end, 3), 'one loud stretch becomes one run in seconds');
runs = D.energyRuns(frames([[0.001, 10], [0.1, 5], [0.001, 20]]));
ok(runs.length === 0, 'a run shorter than one second is dropped');
runs = D.energyRuns(frames([[0.001, 10], [0.1, 15], [0.001, 3], [0.1, 15], [0.001, 10]]));
ok(runs.length === 1 && near(runs[0].start, 1) && near(runs[0].end, 4.3), 'a pause of three frames or fewer does not split a run');
runs = D.energyRuns(frames([[0.001, 10], [0.1, 15], [0.001, 8], [0.1, 15], [0.001, 10]]));
ok(runs.length === 2, 'a longer pause splits the run in two');
runs = D.energyRuns(frames([[0.001, 10], [0.1, 20]]));
ok(runs.length === 1 && near(runs[0].end, 3), 'a run still going at the end closes at the last frame');
ok(D.energyRuns(frames([[0.005, 50]])).length === 0, 'the threshold never drops below 0.008');

// ---- subtract: the part of a run not covered by speech ----
const run = { start: 0, end: 10 };
let out = D.subtract(run, []);
ok(out.length === 1 && out[0].start === 0 && out[0].end === 10, 'with no speech the whole run is left');
out = D.subtract(run, [{ start: 0, end: 10 }]);
ok(out.length === 0, 'full coverage leaves nothing');
out = D.subtract(run, [{ start: 3, end: 5 }]);
ok(out.length === 2 && out[0].end === 3 && out[1].start === 5, 'speech in the middle leaves two gaps');
out = D.subtract(run, [{ start: 3, end: 3.5 }]);
ok(out.length === 2, 'gaps of at least a second are kept even if the cover is small');
out = D.subtract(run, [{ start: 0.5, end: 9.5 }]);
ok(out.length === 0, 'gaps under a second are dropped');
out = D.subtract(run, [{ start: -5, end: 2 }, { start: 4, end: 20 }]);
ok(out.length === 1 && out[0].start === 2 && out[0].end === 4, 'speech overlapping either edge is clipped');
out = D.subtract(run, [{ start: 20, end: 30 }]);
ok(out.length === 1 && out[0].end === 10, 'speech after the run is ignored');

console.log(`${pass} checks passed`);
