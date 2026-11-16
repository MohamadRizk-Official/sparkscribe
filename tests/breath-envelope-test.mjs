// The loudness envelope and where a click starts playing (src/lib/breath.js envelopeFromSamples, breathBefore,
// paragraphStart, sentenceStarts, paragraphIndexAt), on synthetic envelopes with known breaths.
import assert from 'node:assert/strict';
import * as B from '../src/lib/breath.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 1e-9, `${m}: ${a} vs ${b}`); pass++; console.log('ok -', m); };

// ---- envelopeFromSamples: 20 values a second, one byte each
ok(B.ENV_HZ === 20, 'the envelope has 20 values a second');
let env = B.envelopeFromSamples(new Float32Array(16000));
ok(env.length === 20 && env.every((v) => v === 0), 'one second of silence is 20 zeros');
ok(B.envelopeFromSamples(new Float32Array(100)).length === 0, 'less than one frame gives an empty envelope');
ok(B.envelopeFromSamples(new Float32Array(1600), 8000).length === 4, 'the frame length follows the sample rate (8 kHz: 400 samples a frame)');
ok(B.envelopeFromSamples(new Float32Array(1599)).length === 1, 'a partial frame at the end is left out');
env = B.envelopeFromSamples(new Float32Array(1600).fill(1));
ok(env.length === 2 && env[0] === 225 && env[1] === 225, 'full scale (0 dBFS) is 225');
env = B.envelopeFromSamples(new Float32Array(1600).fill(0.5));
ok(env[0] === 210, 'half the amplitude is 6 dB lower: 210');
ok(B.envelopeFromSamples(new Float32Array(1600).fill(16384), 16000, 1 / 32768)[0] === 210, '`scale` turns 16-bit integer samples into -1…1');
ok(B.envelopeFromSamples(new Float32Array(1600).fill(30))[0] === 255, 'a sample far above full scale is capped at 255');
ok(B.envelopeFromSamples(new Float32Array(1600).fill(1e-6))[0] === 0, 'a sample below -90 dBFS is 0');

// ---- breathBefore, on 10 s of speech with two quiet stretches (2.0–2.25 s and 5.0–5.4 s)
const speech = new Uint8Array(200).fill(150);
for (let i = 40; i < 45; i++) speech[i] = 20;
for (let i = 100; i < 108; i++) speech[i] = 20;
near(B.breathBefore(speech, 2.3), 2.03, 'words at 2.3 s: start in the breath just before them (never before it began, plus 0.03 s)');
near(B.breathBefore(speech, 2.0), 2.03, 'words at 2.0 s: the breath that ends just after is used');
near(B.breathBefore(speech, 5.45), 5.03, 'the breath may be up to half a second of lead before a later breath');
near(B.breathBefore(speech, 5.45, { lead: 0.1 }), 5.3, 'a shorter lead starts closer to the words');
near(B.breathBefore(speech, 3.5), 3.35, 'no breath near the target: start 0.15 s before it');
near(B.breathBefore(speech, 3.5, { miss: 0.4 }), 3.1, '…or as far before as `miss` says');
near(B.breathBefore(speech, 0.05), 0, 'a start is never negative');
near(B.breathBefore(null, 3), 2.85, 'no envelope: 0.15 s before the target');
near(B.breathBefore(new Uint8Array(0), 3), 2.85, 'an empty envelope is treated as none');
near(B.breathBefore(new Uint8Array(200).fill(120), 3), 2.85, 'steady noise (no gap between quiet and speech) has no breaths');

// ---- paragraphStart
const segs = [{ start: 0, end: 4.5, speaker: 'A', text: 'First part here. Second part there.' }, { start: 4.5, end: 9, speaker: 'B', text: 'Another voice.' }];
near(B.paragraphStart(segs, 0, null), 0, 'no envelope: a little before the start, never below 0');
near(B.paragraphStart(segs, 1, null), 4.4, 'no envelope: 0.1 s before the paragraph');
near(B.paragraphStart(segs, 1, speech), 4.35, 'with an envelope but no breath nearby: 0.15 s before the paragraph');
ok(B.paragraphStart(segs, 7, speech) === 0, 'a paragraph that does not exist starts at 0');

// ---- sentenceStarts
ok(B.sentenceStarts(segs, 7, speech).length === 0, 'no such paragraph: no starts');
let st = B.sentenceStarts([{ start: 0, end: 4, speaker: 'A', text: 'One sentence only' }], 0, speech);
ok(st.length === 1, 'one sentence: one start');
st = B.sentenceStarts(segs, 0, null);
ok(st.length === 2 && st[0] === 0 && st[1] > 0 && st[1] < 4.5, 'no envelope: the second sentence starts inside the paragraph, shared out by text length');
st = B.sentenceStarts([{ start: 0, end: 9, speaker: 'A', text: 'First part here. Second part there.' }], 0, speech);
ok(st.length === 2 && st[0] === 0, 'with an envelope: one start per sentence, the first at the paragraph start');
near(st[1], 5.03, '…and the second in the breath that falls where the sentence break is expected');
st = B.sentenceStarts(segs, 0, null, { text: 'Yes sir. Okay then. Fine now.' });
ok(st.length === 3, 'the text shown (o.text) decides how many sentences there are');
ok(st.every((t, k) => k === 0 || t >= st[k - 1]), 'sentence starts never go backwards');

// ---- paragraphIndexAt
const rows = [{ start: 0 }, { start: 10 }, { start: 20 }];
ok(B.paragraphIndexAt(rows, 15) === 1, 'a time inside a paragraph belongs to it');
ok(B.paragraphIndexAt(rows, 10) === 1, 'a time at a start belongs to that paragraph');
ok(B.paragraphIndexAt(rows, 9.96) === 1, 'a time up to 0.05 s before a start already belongs to it (rounding of stored times)');
ok(B.paragraphIndexAt(rows, 9.9) === 0, '…but not 0.1 s before');
ok(B.paragraphIndexAt(rows, 999) === 2, 'after the last start: the last paragraph');
ok(B.paragraphIndexAt(rows, -1) === -1, 'before the first start: none');
ok(B.paragraphIndexAt([], 5) === -1, 'no paragraphs: none');

console.log(`${pass} checks passed`);
