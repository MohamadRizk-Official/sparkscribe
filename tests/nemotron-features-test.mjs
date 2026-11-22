// Nemotron front end (src/engine/nemotron.js nemotronFeatures): frame count, log floor and where a tone's energy lands.
// Uses a synthetic "mel" matrix where row m reads exactly FFT bin 2m, so the output can be checked by hand.
import assert from 'node:assert/strict';
const { nemotronFeatures } = await import(new URL('../src/engine/nemotron.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

const NMEL = 128, NBIN = 257, SR = 16000, HOP = 160;
const mel = new Float32Array(NMEL * NBIN);
for (let m = 0; m < NMEL; m++) mel[m * NBIN + 2 * m] = 1;
const floor = Math.log(2 ** -24);

// ---- frame count is floor(samples / 160), 128 values per frame
for (const n of [0, 159, 160, 1600, 16000, 16123]) {
  const r = nemotronFeatures(new Float32Array(n), mel);
  ok(r.n === Math.floor(n / HOP) && r.feats.length === r.n * NMEL, `${n} samples give ${Math.floor(n / HOP)} frames of ${NMEL} values`);
}

// ---- silence sits exactly on the log floor, everywhere
const quiet = nemotronFeatures(new Float32Array(SR), mel);
ok(quiet.feats.every((v) => Math.abs(v - floor) < 1e-4), 'digital silence is log(2^-24) in every bin of every frame');
ok(quiet.feats.every(Number.isFinite), 'no NaN or infinity');

// ---- a tone on FFT bin 64 (= 2000 Hz) lights mel row 32 and nothing near it, in the middle of the signal
const tone = new Float32Array(SR);
for (let i = 0; i < tone.length; i++) tone[i] = 0.5 * Math.sin((2 * Math.PI * 2000 * i) / SR);
const t = nemotronFeatures(tone, mel);
const mid = Math.floor(t.n / 2) * NMEL;
const row = Array.from(t.feats.subarray(mid, mid + NMEL));
const peak = row.indexOf(Math.max(...row));
ok(peak === 32, `a 2000 Hz tone peaks in row 32 (got ${peak})`);
ok(row[32] > row[10] + 10 && row[32] > row[100] + 10, 'the tone is far above rows tens of bins away');
ok(row[10] < floor + 15, 'rows far from the tone stay close to the floor');

// ---- a constant (DC) signal only reaches the lowest bins; everything above bin ~8 stays near the floor
const dc = nemotronFeatures(new Float32Array(SR).fill(0.5), mel);
const dcMid = Math.floor(dc.n / 2) * NMEL;
const dcRow = Array.from(dc.feats.subarray(dcMid, dcMid + NMEL));
ok(dcRow[0] > dcRow[20] + 10, 'a constant signal puts its energy in the lowest row');
ok(Math.max(...dcRow.slice(8)) < floor + 15, 'and leaves the higher rows close to the floor');

// ---- louder input gives larger features, by about 20·log10(ratio) in power terms (here ×4 amplitude → +2·ln(4))
const loud = new Float32Array(tone.length);
for (let i = 0; i < loud.length; i++) loud[i] = tone[i] * 4;
const l = nemotronFeatures(loud, mel);
const gain = l.feats[mid + 32] - t.feats[mid + 32];
ok(Math.abs(gain - 2 * Math.log(4)) < 0.05, `four times the amplitude adds 2·ln 4 = ${(2 * Math.log(4)).toFixed(2)} to the log power (got ${gain.toFixed(2)})`);

// ---- the input is not modified
const copy = Float32Array.from(tone);
nemotronFeatures(tone, mel);
ok(tone.every((v, i) => v === copy[i]), 'the input samples are left unchanged');

console.log(`\n${pass} checks passed`);
