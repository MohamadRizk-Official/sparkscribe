// Sentence-click timing (src/lib/sentence-timing.js createSentenceTiming) without a worker: stored word times,
// the fallbacks while a paragraph is not timed, and the bookkeeping calls. In plain Node nothing can time words
// (no pointer or worker), so timing is switched off and only what was loaded is used.
import assert from 'node:assert/strict';
const T = await import(new URL('../src/lib/sentence-timing.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const near = (a, b, e = 0.06) => Math.abs(a - b) < e;

ok(T.RATE === 16000, 'the aligner works at 16 kHz');
ok(T.decodeLowRate === T.decodeForTiming, 'decodeLowRate is the same function as decodeForTiming');
ok(await T.decodeForTiming(null) === null, 'no audio decodes to null');
ok(await T.decodeForTiming({ size: 200e6 }) === null, 'audio over 150 MB is not decoded');
ok(await T.decodeForTiming({ size: 10 }) === null, 'without an audio context nothing is decoded');

const segs = [
  { start: 10, end: 14, text: 'Hello world. This is two.', speaker: 'A' },
  { start: 20, end: 22, text: 'Another paragraph here.', speaker: 'A' },
];
const make = () => T.createSentenceTiming({ getSegs: () => segs, getEnv: () => null, getBlob: () => null });
const st = make();
ok(st.canTime() === false, 'timing is off when the device cannot do it');
ok(st.isTimed(0) === false && st.isTimed(99) === false, 'nothing is timed at first');

// the paragraph's first sentence starts at the paragraph start; no estimate envelope is needed
ok(st.startOf(0, 0) === 10, 'untimed: the first sentence starts at the paragraph start');
ok(st.startOf(1, 0, 'Another paragraph here.') === 20, 'untimed: a one-sentence paragraph starts at its own start');
ok(st.startOf(99, 0) === 0, 'an unknown paragraph starts at 0');

// stored timings: keys are the paragraph start with two decimals
st.load({ v: 2, model: 'w2v-ctc-fp16-onset1', s: { '10.00': { w: [['hello', 10.2, 10.5], ['world', 10.6, 11], ['this', 12, 12.2], ['is', 12.3, 12.4], ['two', 12.5, 12.9]], p: 9.5 } } }, 'rec-1');
ok(st.isTimed(0) === true && st.isTimed(1) === false, 'loaded timings mark their paragraph as timed');
ok(near(st.startOf(0, 0), 10.15), 'the first sentence starts just before its first word');
ok(near(st.startOf(0, 1), 11.95), 'a later sentence starts just before its first word, not at the paragraph start');
ok(st.startOf(0, 1) >= 11.02, 'and never back into the previous word');

const other = make();
other.load({ v: 2, model: 'older-model', s: { '10.00': { w: [], p: null } } });
ok(other.isTimed(0) === false, 'timings saved by another model are ignored');
other.load({ v: 1, model: 'w2v-ctc-fp16-onset1', s: { '10.00': { w: [], p: null } } });
ok(other.isTimed(0) === false, 'timings in an older format are ignored');
other.load(null);
ok(other.isTimed(0) === false, 'no stored timings is fine');

// forget: the lines were split, so their word times are dropped
st.forget([10]);
ok(st.isTimed(0) === false, 'forget drops the word times of a paragraph by its start');
st.forget([123]);
ok(true, 'forgetting an unknown paragraph does nothing');

// timeNow: nothing to wait for when timing is off
const t0 = Date.now();
await st.timeNow(0, 5000);
ok(Date.now() - t0 < 1000, 'timeNow does not wait when timing is off');
ok(await st.alignForSpeakers([{ audio: new Float32Array(1), offset: 0, words: ['a'] }]) === null, 'speaker word timing reports null when timing is off');

st.reset();
ok(st.isTimed(0) === false && st.canTime() === false, 'reset clears everything');
console.log(`${pass} checks passed`);
