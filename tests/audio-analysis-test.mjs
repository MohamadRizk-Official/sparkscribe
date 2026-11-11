// Audio quality analysis and conservative preprocessing (src/engine/preprocess.js), on synthetic 16 kHz signals.
import assert from 'node:assert/strict';
const { analyzeAudio, preprocess } = await import(new URL('../src/engine/preprocess.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const SR = 16000;
const make = (sec, f) => Float32Array.from({ length: SR * sec }, (_, i) => f(i));
// 0.3 s tone bursts (220 Hz) separated by 0.3 s of a faint hiss, 4 s long
const speechLike = (amp) => make(4, (i) => (Math.floor(i / 4800) % 2 ? amp * Math.sin((2 * Math.PI * 220 * i) / SR) : 0.0005 * Math.sin(i)));
const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

// ---- analyzeAudio ----
let a = analyzeAudio(new Float32Array(100));
ok(a.rating === 'difficult' && a.issues[0] === 'Recording is too short' && Object.keys(a.measured).length === 0, 'less than one 30 ms frame is "too short"');

a = analyzeAudio(new Float32Array(SR * 3));
ok(a.rating === 'difficult' && a.issues.includes('Very little speech detected') && a.issues.includes('Very quiet recording'), 'digital silence is flagged as no speech and very quiet');
ok(a.measured.speechPercent === 0 && a.measured.clippedPercent === 0, 'silence measures 0% speech and 0% clipping');

a = analyzeAudio(speechLike(0.3));
ok(a.rating === 'good' && a.issues.length === 0, 'clear speech-level bursts over a quiet floor rate "good"');
ok(a.measured.snrDb > 40 && a.measured.speechPercent > 30 && a.measured.speechPercent < 70, 'a clean signal measures a high SNR and about half active frames');
ok(a.measured.snrDb <= 60, 'SNR is capped at 60 dB');
ok(a.measured.peakDb < 0, 'peak level is below 0 dBFS');

a = analyzeAudio(speechLike(0.003));
ok(a.rating === 'difficult' && a.issues.includes('Very quiet recording'), 'very low speech level is flagged as very quiet');

a = analyzeAudio(make(3, (i) => (Math.sin(i) > 0 ? 1 : -1)));
ok(a.rating === 'difficult' && a.issues.includes('Heavy distortion (clipping)'), 'a clipped square wave is flagged as heavy distortion');
ok(a.measured.clippedPercent > 90 && a.measured.peakDb === 0, 'clipping percentage and peak are measured');

ok(['good', 'fair', 'difficult'].includes(analyzeAudio(speechLike(0.05)).rating), 'rating is always one of good / fair / difficult');

// ---- preprocess ----
let x = make(2, (i) => 0.1 + 0.01 * Math.sin((2 * Math.PI * 440 * i) / SR));
const n = x.length;
let info = preprocess(x, analyzeAudio(x));
ok(x.length === n, 'sample count never changes (timestamps stay 1:1)');
ok(info.dcRemoved === true && info.highpassHz === 70, 'reports DC removal and the 70 Hz high-pass');
const mean = x.reduce((s, v) => s + v, 0) / x.length;
ok(Math.abs(mean) < 0.01, 'a constant DC offset is removed');

x = speechLike(0.01);
const analysis = analyzeAudio(x);
info = preprocess(x, analysis);
ok(info.gainDb > 0 && info.gainDb <= 24, 'quiet speech is boosted, by at most 24 dB');
ok(peak(x) <= 1, 'the boosted signal does not exceed full scale');

x = speechLike(0.9);
info = preprocess(x, analyzeAudio(x));
ok(info.gainDb <= 0 && info.gainDb >= -6, 'loud speech is turned down by at most 6 dB');
ok(peak(x) <= 1, 'loud speech stays within full scale');

ok(preprocess(new Float32Array(0), null).gainDb === 0, 'an empty signal is handled');
ok(typeof preprocess(speechLike(0.1), undefined).gainDb === 'number', 'preprocess works without an analysis');

console.log(`${pass} checks passed`);
