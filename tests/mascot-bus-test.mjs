// How the app talks to the mascot (src/mascot/bus.js): mascotSignal and mascotTravel never throw and never need a mascot.
import assert from 'node:assert/strict';

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

// no window, no sessionStorage: nothing happens and nothing throws
const B = await import(new URL('../src/mascot/bus.js', import.meta.url).href);
let threw = false;
try { B.mascotSignal('ask-start'); B.mascotTravel(); } catch { threw = true; }
ok(!threw, 'with no window or storage both calls are silent no-ops');

// with a window: the signal arrives as a sparkscribe:mascot event
globalThis.window = new EventTarget();
globalThis.CustomEvent = class extends Event { constructor(type, init = {}) { super(type); this.detail = init.detail; } };
const heard = [];
window.addEventListener('sparkscribe:mascot', (e) => heard.push(e.detail));
B.mascotSignal('quiz-correct', { streak: 3 });
ok(heard.length === 1 && heard[0].type === 'quiz-correct' && heard[0].streak === 3, 'the event carries the type and any extra detail');
B.mascotSignal('ask-start');
ok(heard[1].type === 'ask-start' && Object.keys(heard[1]).join() === 'type', 'a signal with no detail carries only its type');
B.mascotSignal('x', { type: 'overridden' });
ok(heard[2].type === 'overridden', 'a detail field called type replaces the signal type (the detail is spread last)');

// travel: remembers when the app left for another page
const store = new Map();
globalThis.sessionStorage = { setItem: (k, v) => store.set(k, v), getItem: (k) => store.get(k) ?? null };
const before = Date.now();
B.mascotTravel();
const t = Number(store.get('sparkscribe.mascot.travel'));
ok(t >= before && t <= Date.now(), 'mascotTravel stores the current time under sparkscribe.mascot.travel');
globalThis.sessionStorage = { setItem() { throw new Error('storage blocked'); } };
threw = false;
try { B.mascotTravel(); } catch { threw = true; }
ok(!threw, 'blocked storage does not break navigation');

console.log(`${pass} checks passed`);
