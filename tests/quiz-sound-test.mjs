// Practice Quiz answer sounds (src/lib/quiz-sound.js): the on/off setting kept in this browser, and that sounds are only
// made when they are on. Web Audio and storage are stand-ins; nothing is played.
import assert from 'node:assert/strict';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

const data = new Map();
globalThis.localStorage = { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
const made = { contexts: 0, oscillators: [], resumed: 0 };
class FakeAudioContext {
  constructor() { made.contexts++; this.currentTime = 0; this.state = 'suspended'; this.destination = {}; }
  resume() { made.resumed++; this.state = 'running'; }
  createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n) => n }; }
  createOscillator() {
    const o = { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n) => n, start() {}, stop() {} };
    made.oscillators.push(o);
    return o;
  }
}
globalThis.window = { AudioContext: FakeAudioContext };
const Q = await import(new URL('../src/lib/quiz-sound.js', import.meta.url).href);

// ---- the setting
ok(Q.QUIZ_SOUND_KEY === 'sparkscribe.quizSounds', 'the setting has its own key in this browser');
ok(Q.quizSoundsOn() === true, 'sounds are on until someone turns them off');
Q.setQuizSounds(false);
ok(data.get(Q.QUIZ_SOUND_KEY) === '0' && Q.quizSoundsOn() === false, 'turning sounds off is stored as "0"');
Q.setQuizSounds(true);
ok(data.get(Q.QUIZ_SOUND_KEY) === '1' && Q.quizSoundsOn() === true, 'turning them on is stored as "1"');
data.set(Q.QUIZ_SOUND_KEY, 'anything else');
ok(Q.quizSoundsOn() === true, 'any stored value other than "0" means on');

// ---- nothing is made while off
Q.setQuizSounds(false);
ok(Q.primeQuizSound() === null, 'off: priming makes no audio context');
Q.playAnswerSound(true);
Q.playAnswerSound(false);
ok(made.contexts === 0 && made.oscillators.length === 0, 'off: neither answer plays anything');

// ---- on: a chime for right, a low tone for wrong
Q.setQuizSounds(true);
const ac = Q.primeQuizSound();
ok(ac instanceof FakeAudioContext && made.contexts === 1 && made.resumed === 1, 'on: priming creates one audio context and wakes it if it was suspended');
ok(Q.primeQuizSound() === ac && made.contexts === 1, 'the context is created once and reused');
Q.playAnswerSound(true);
ok(made.oscillators.length === 3 && made.oscillators.every((o) => o.type === 'sine'), 'a right answer plays three sine notes');
made.oscillators.length = 0;
Q.playAnswerSound(false);
ok(made.oscillators.length === 2 && made.oscillators.every((o) => o.type === 'triangle'), 'a wrong answer plays two softer triangle notes');

// ---- storage that throws
const realStorage = globalThis.localStorage;
globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
ok(Q.quizSoundsOn() === true, 'blocked storage: sounds default to on');
Q.setQuizSounds(false);
ok(true, 'blocked storage: turning them off does not throw (it applies to this page only)');
globalThis.localStorage = realStorage;

console.log(`${pass} checks passed`);
