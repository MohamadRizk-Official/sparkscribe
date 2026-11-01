// Word timing for sentence clicks (src/lib/ctc-align.js) on synthetic letter probabilities: forced alignment places
// known words, and a paragraph whose opening words the previous paragraph's context took over is aligned again alone.
//   node tests/ctc-align-test.mjs
import assert from 'node:assert/strict';
import { forcedAlign, alignParagraph } from '../src/lib/ctc-align.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ'";
const vocab = { '<pad>': 0, '|': 1 };
[...letters].forEach((c, i) => (vocab[c] = i + 2));
const V = Object.keys(vocab).length;
// frames of 20 ms; marks = [[frame, letter, probability]]: everything else is mostly blank
function probs(frames, marks) {
  const lp = new Float32Array(frames * V);
  for (let t = 0; t < frames; t++) {
    const p = new Float64Array(V).fill(0.03 / (V - 1));
    p[0] = 0.97;
    for (const [f, c, q] of marks) if (f === t) { p.fill((1 - q - 0.05) / (V - 2)); p[0] = 0.05; p[vocab[c]] = q; }
    for (let v = 0; v < V; v++) lp[t * V + v] = Math.log(p[v]);
  }
  return lp;
}
// a spoken word: its letters two frames apart, then the word separator (as the real model emits it)
const word = (f, w, q = 0.9) => [...[...w].map((c, i) => [f + 2 * i, c, q]), [f + 2 * w.length, '|', q]];

// 1. plain alignment: words land where their letters are
{
  const lp = probs(60, [...word(10, 'SO'), ...word(30, 'YES')]);
  const al = forcedAlign(lp, 60, vocab, ['So', 'yes.']);
  ok(Math.abs(al[0].s - 0.2) < 0.03 && Math.abs(al[1].s - 0.6) < 0.03, 'each word starts at its first letter (punctuation and case ignored)');
}
// 2. the previous speaker's last word really is before the paragraph: the context is kept and its end reported
{
  const lp = probs(80, [...word(5, 'SO'), ...word(30, 'SO'), ...word(45, 'YES')]);
  const r = alignParagraph(lp, 80, vocab, ['so'], ['So', 'yes'], 0.58);
  ok(!r.alone && Math.abs(r.words[0].s - 0.6) < 0.03 && r.prevEnd < 0.3, 'context before the paragraph start: kept, the paragraph starts on its own first word');
}
// 3. the context word was not heard (quiet, overlapped): jointly it takes this paragraph's first word, which is
//    pushed onto weak evidence much later; the paragraph is aligned again alone and starts on its own first word
{
  const lp = probs(90, [...word(30, 'SO'), ...word(60, 'SO', 0.2), ...word(72, 'YES')]);
  const joint = alignParagraph(lp, 90, vocab, ['so'], ['So', 'yes'], null);
  ok(joint.words[0].s > 1.0, '(set-up) aligned jointly, the paragraph\'s first word is pushed late');
  const r = alignParagraph(lp, 90, vocab, ['so'], ['So', 'yes'], 0.58);
  ok(r.alone && Math.abs(r.words[0].s - 0.6) < 0.03 && r.prevEnd === null, 'context taking over the paragraph start: aligned alone, first word back at its real start');
}
// 4. no context: unchanged
{
  const lp = probs(60, [...word(10, 'SO'), ...word(30, 'YES')]);
  const r = alignParagraph(lp, 60, vocab, [], ['So', 'yes'], 0.2);
  ok(!r.alone && r.prevEnd === null && Math.abs(r.words[0].s - 0.2) < 0.03, 'without context words nothing changes');
}

console.log(`\n${pass} checks passed`);
