// WhisperControl and TokenLogprobRecorder (src/engine/decoding.js) driven by hand-made logits: forced language/task
// tokens, the no-speech probability, token suppression, the per-clip budget, the loop guard and the average log-probability.
// No model: a "vocabulary" of a few dozen tokens and Float32Array logits.
//   node tests/whisper-control-test.mjs
import assert from 'node:assert/strict';
const { WhisperControl, TokenLogprobRecorder } = await import(new URL('../src/engine/decoding.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

const V = 30, EOS = 29, EN = 25, TRANSCRIBE = 26, NOSPEECH = 27;
const logitsOf = (fill = 0) => ({ data: new Float32Array(V).fill(fill) });
const allowed = (data) => [...data].map((x, i) => (x > -Infinity ? i : -1)).filter((i) => i >= 0);
const make = (over = {}) => new WhisperControl({ promptLen: 2, forced: [EN, TRANSCRIBE], noSpeechId: NOSPEECH, suppress: [3, 4], eosId: EOS, budgets: [5], ...over });
const prompt = [20, 21]; // two prompt tokens

// ---- forced tokens and the no-speech probability
const w = make();
let l = logitsOf();
w._call([prompt], [l]);
ok(allowed(l.data).join() === String(EN), 'right after the prompt only the forced language token is possible');
ok(Math.abs(w.noSpeech[0] - 1 / V) < 1e-6, 'the no-speech probability is read at the first step (uniform logits: 1/V)');
l = logitsOf();
w._call([[...prompt, EN]], [l]);
ok(allowed(l.data).join() === String(TRANSCRIBE), 'the second forced token is the task');
ok(w.noSpeech.length === 1, 'the no-speech probability is read once, not again at later steps');

// a forced token that the model's own config suppressed (-Infinity) is made possible again
l = logitsOf(); l.data[EN] = -Infinity;
make()._call([prompt], [l]);
ok(allowed(l.data).join() === String(EN) && Number.isFinite(l.data[EN]), 'a forced token that arrived as -Infinity is made finite again');

// ---- suppression and the first text token
l = logitsOf();
const textPrompt = [...prompt, EN, TRANSCRIBE];
make({ blankId: 7 })._call([textPrompt], [l]);
ok(l.data[3] === -Infinity && l.data[4] === -Infinity, 'suppressed tokens are impossible');
ok(l.data[7] === -Infinity, 'the first text token cannot be a blank');
ok(l.data[EOS] === -Infinity, 'without timestamps the clip cannot end before any text');
ok(l.data[10] === 0, 'ordinary tokens are untouched');

// ---- budget
const wb = make({ budgets: [3] });
l = logitsOf();
wb._call([[...textPrompt, 10, 11, 12]], [l]);
ok(wb.stopped[0] === 'budget' && allowed(l.data).join() === String(EOS), 'a clip that reaches its token budget is stopped and forced to end');
l = logitsOf();
wb._call([[...textPrompt, 10, 11, 12, 13]], [l]);
ok(allowed(l.data).join() === String(EOS), 'a stopped clip stays at the end token while the rest of the batch finishes');

// ---- loop guard
const wl = make({ budgets: [100] });
const looping = [...textPrompt, ...Array(9).fill(12)];
l = logitsOf();
wl._call([looping], [l]);
ok(wl.stopped[0] === 'loop' && wl.loopAt[0] === 0 && allowed(l.data).join() === String(EOS), 'nine repeats of one token are a loop: the clip ends and remembers where the run began');
const wl2 = make({ budgets: [100] });
l = logitsOf();
wl2._call([[...textPrompt, 12, 12, 12]], [l]);
ok(wl2.stopped[0] === undefined && allowed(l.data).length > 1, 'three repeats (ordinary emphasis) are not a loop');

// ---- an already finished row stays finished
const wf = make();
l = logitsOf();
wf._call([[...textPrompt, 10, EOS]], [l]);
ok(allowed(l.data).join() === String(EOS), 'after the end token the row is kept at the end token');

// ---- timestamps: only timestamps (>= begin) can open a clip, and none past the clip's real length
const begin = 20;
const wt = make({ timestamps: { begin, noTimestampsId: 24, maxIndex: [4], maxInitialIndex: 2 }, budgets: [50] });
l = logitsOf();
wt._call([textPrompt], [l]);
ok(allowed(l.data).join() === '20,21,22', 'a clip starts with a timestamp, no later than the first allowed index');
l = logitsOf();
wt._call([[...textPrompt, 20, 10, 11, 21]], [l]);
const a = allowed(l.data);
ok(a.every((t) => t >= begin && t <= begin + 4 || t === EOS || t < begin), 'no timestamp beyond the clip\'s real length is possible');
ok(!a.includes(24), 'the no-timestamps token is never possible in timestamp mode');

// ---- TokenLogprobRecorder
const rec = new TokenLogprobRecorder(EOS, 2, 1);
const uniform = () => ({ data: new Float32Array(V).fill(0) });
rec._call([[10n, 11n]], [uniform()]);                 // prompt only: nothing to score yet
rec._call([[10n, 11n, 5n]], [uniform()]);             // token 5 chosen under a uniform distribution
const lp = rec.finish([[10n, 11n, 5n, 6n]]);
ok(Math.abs(lp[0] - Math.log(1 / V)) < 1e-5, 'the average log-probability of tokens chosen under uniform logits is log(1/V)');
const none = new TokenLogprobRecorder(EOS, 2, 1);
ok(none.finish([[10n, 11n]])[0] === 0, 'a clip with no generated tokens scores 0');
console.log(`\n${pass} checks passed`);
