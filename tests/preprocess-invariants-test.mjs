// Properties of the audio preprocessing copy (src/engine/preprocess.js) that the pipeline relies on:
// same length (timestamps stay 1:1), no sample beyond full scale, no NaN, quiet speech is lifted, DC is removed.
import assert from 'node:assert/strict';
const { analyzeAudio, preprocess } = await import(new URL('../src/engine/preprocess.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

const SR = 16000;
// speech-like: 220 Hz tone in bursts (0.4 s on, 0.4 s off) at the given amplitude, plus a DC offset
const make = (seconds, amp, dc = 0) => {
  const x = new Float32Array(Math.floor(seconds * SR));
  for (let i = 0; i < x.length; i++) x[i] = dc + (Math.floor(i / (0.4 * SR)) % 2 === 0 ? amp * Math.sin((2 * Math.PI * 220 * i) / SR) : 0);
  return x;
};
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / (x.length || 1));
const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;

// ---- length is never changed
for (const amp of [0.001, 0.05, 0.5, 1]) {
  const x = make(3, amp);
  const n = x.length;
  const out = x;
  preprocess(out, analyzeAudio(out));
  ok(out.length === n, `amplitude ${amp}: the sample count is unchanged`);
  ok(out.every(Number.isFinite), `amplitude ${amp}: every sample is a finite number`);
  ok(peak(out) < 1, `amplitude ${amp}: no sample reaches full scale`);
}

// ---- quiet speech is lifted toward -20 dBFS, loud speech is not pushed up
const quiet = make(4, 0.004);
const before = rms(quiet);
const info = preprocess(quiet, analyzeAudio(quiet));
ok(info.gainDb > 6 && info.gainDb <= 24, `quiet speech gets a boost within the +24 dB cap (${info.gainDb} dB)`);
ok(rms(quiet) > before * 2, 'and is clearly louder afterwards');

const loud = make(4, 0.9);
ok(preprocess(loud, analyzeAudio(loud)).gainDb <= 0, 'speech that is already loud is not boosted');

// ---- DC offset is removed
const dc = make(3, 0.2, 0.1);
ok(Math.abs(mean(dc)) > 0.04, 'the test signal starts with a clear DC offset');
preprocess(dc, analyzeAudio(dc));
ok(Math.abs(mean(dc)) < 0.01, 'the DC offset is gone afterwards');

// ---- the report says what was done
const rep = preprocess(make(2, 0.1), null);
ok(rep.dcRemoved === true && rep.highpassHz === 70 && typeof rep.gainDb === 'number', 'the result reports DC removal, the 70 Hz filter and the gain');

// ---- silence stays silent and finite
const silent = new Float32Array(SR * 2);
preprocess(silent, analyzeAudio(silent));
ok(silent.every((v) => v === 0 || Math.abs(v) < 1e-6), 'digital silence stays silent');

console.log(`\n${pass} checks passed`);
