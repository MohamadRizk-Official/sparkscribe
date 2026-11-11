// Where playback starts for a sentence (src/lib/seek.js): sentenceAnchor, seekToSentence, quietPoint.
import assert from 'node:assert/strict';
const S = await import(new URL('../src/lib/seek.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const near = (a, b) => Math.abs(a - b) < 1e-9;

const words = [['hello', 1, 1.3], ['world', 1.4, 1.8], ['this', 2.5, 2.7], ['is', 2.8, 2.9], ['two', 3.0, 3.4]];
const text = 'Hello world. This is two.';

// ---- sentenceAnchor ----
let a = S.sentenceAnchor({ text, k: 1, words });
ok(a.word.w === 'this' && near(a.onset, 2.5) && a.skipped === 0, 'the second sentence anchors on its first word "this"');
ok(a.prev.w === 'world' && near(a.floor, 1.82), 'the floor is just after the previous word ended');
a = S.sentenceAnchor({ text, k: 0, words });
ok(near(a.onset, 1) && a.prev === null, 'the first sentence has no previous word');
ok(a.floor === -Infinity, 'without a known previous end the floor is -Infinity');
a = S.sentenceAnchor({ text, k: 0, words, prevEnd: 0.4 });
ok(near(a.floor, 0.42), 'a known previous line end sets the floor');
a = S.sentenceAnchor({ text, k: 1, words, bias: 0.15 });
ok(near(a.onset, 2.35), 'bias shifts word times earlier (word times run late)');
ok(S.sentenceAnchor({ text, k: 0, words: [] }) === null && S.sentenceAnchor({ text, k: 0 }) === null, 'no word times gives null');
ok(S.sentenceAnchor({ text: 'zzz qqq.', k: 0, words }) === null, 'a sentence whose words are not in the word times gives null');

// ---- seekToSentence ----
ok(S.LEAD_S === 0.05, 'default lead is 0.05 s');
ok(near(S.seekToSentence({ text, k: 1, words }), 2.45), 'start just before the first word');
ok(near(S.seekToSentence({ text, k: 0, words }), 0.95), 'the first sentence too');
ok(near(S.seekToSentence({ text, k: 1, words, lead: 0.2 }), 2.3), 'the lead can be overridden');
ok(S.seekToSentence({ text, k: 0, words: [] }) === null, 'null when the words were not found');
const tight = [['yes', 1, 1.5], ['right', 1.52, 1.7]];
ok(near(S.seekToSentence({ text: 'Yes. Right.', k: 1, words: tight }), 1.52), 'never starts inside the previous word when the pause is tiny');
ok(S.seekToSentence({ text: 'Hi there.', k: 0, words: [['hi', 0.01, 0.2], ['there', 0.3, 0.5]] }) === 0, 'never returns a negative time');

// ---- quietPoint ----
const rate = 1000;
const loud = new Float32Array(rate * 2).fill(0.5);
for (let i = 800; i < 900; i++) loud[i] = 0;
ok(near(S.quietPoint(loud, rate, 0, 2), 0.815), 'finds the quietest 10 ms step (the gap), smoothed over 30 ms');
ok(S.quietPoint(loud, rate, 0, 0.01) === null, 'a window under three 10 ms steps gives null');
const q = S.quietPoint(loud, rate, 0.5, 1.5);
ok(q > 0.8 && q < 0.9, 'the window can be limited to a range');
const pcm = new Int16Array(rate * 2).fill(16000);
for (let i = 1200; i < 1300; i++) pcm[i] = 0;
const p = S.quietPoint(pcm, rate, 0, 2, 1 / 32768);
ok(p > 1.2 && p < 1.3, 'works on 16-bit samples with a scale');
ok(S.quietPoint(new Float32Array(10), rate, -5, 50) === null, 'out-of-range windows are clamped (and too short here)');

console.log(`${pass} checks passed`);
