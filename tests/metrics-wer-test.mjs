// Word and character error rates (src/lib/metrics.js align, wer, cer, pct), checked against hand-counted cases.
import assert from 'node:assert/strict';
import { align, wer, cer, pct } from '../src/lib/metrics.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 1e-9, `${m}: ${a} vs ${b}`); pass++; console.log('ok -', m); };

// align: counts and operations
let a = align(['a', 'b', 'c'], ['a', 'b', 'c']);
ok(a.C === 3 && a.S === 0 && a.D === 0 && a.I === 0 && a.N === 3, 'identical sequences: all correct');
ok(a.ops.every((o) => o.op === 'ok'), '…and every operation is "ok"');
a = align(['a', 'b', 'c'], ['a', 'x', 'c']);
ok(a.S === 1 && a.C === 2 && a.ops[1].op === 'sub' && a.ops[1].ref === 'b' && a.ops[1].hyp === 'x', 'one different word is one substitution');
a = align(['a', 'b', 'c'], ['a', 'c']);
ok(a.D === 1 && a.ops.some((o) => o.op === 'del' && o.ref === 'b'), 'a missing word is a deletion');
a = align(['a', 'c'], ['a', 'b', 'c']);
ok(a.I === 1 && a.ops.some((o) => o.op === 'ins' && o.hyp === 'b'), 'an extra word is an insertion');
a = align([], ['x', 'y']);
ok(a.I === 2 && a.N === 0 && a.ops.length === 2, 'an empty reference: everything is inserted');
a = align(['x', 'y'], []);
ok(a.D === 2 && a.N === 2, 'an empty hypothesis: everything is deleted');
a = align([], []);
ok(a.N === 0 && a.ops.length === 0, 'two empty sequences have no operations');
a = align(['the', 'cat', 'sat'], ['a', 'cat', 'sat', 'down']);
ok(a.S === 1 && a.I === 1 && a.C === 2, 'a substitution and an insertion are counted together');
ok(a.ops.map((o) => o.op).join() === 'sub,ok,ok,ins', '…in reading order');

// wer
let r = wer('the cat sat on the mat', 'the cat sat on the mat');
near(r.wer, 0, 'identical text: WER 0');
r = wer('the cat sat on the mat', 'the cat sat on a mat');
near(r.wer, 1 / 6, 'one wrong word in six: WER 1/6');
ok(r.S === 1 && r.N === 6, '…one substitution over six reference words');
r = wer('one two three four', 'one two');
near(r.wer, 0.5, 'two words missing out of four: WER 0.5');
r = wer('one two', 'one two three four');
near(r.wer, 1, 'two extra words on a two-word reference: WER 1 (insertions count)');
r = wer('one', 'one two three');
near(r.wer, 2, 'WER can exceed 1');
r = wer('', '');
near(r.wer, 0, 'nothing to say and nothing said: WER 0');
r = wer('', 'something');
near(r.wer, 1, 'an empty reference with an extra word: WER 1, not a division by zero');
r = wer('Hello, World!', 'hello world');
near(r.wer, 0, 'case and punctuation do not count as errors');
r = wer('مدرسة جميلة', 'مدرسه جميله');
near(r.wer, 0, 'Arabic spelling variants do not count as errors');
r = wer('مدرسة', 'مدرسه', { arabic: false });
near(r.wer, 1, '…unless Arabic folding is switched off');

// cer ignores spaces
let c = cer('hello world', 'helloworld');
near(c.cer, 0, 'CER ignores where the spaces are');
ok(c.N === 10, '…and counts the letters only');
c = cer('abcd', 'abxd');
near(c.cer, 0.25, 'one wrong letter in four: CER 0.25');
c = cer('abcd', 'abcde');
near(c.cer, 0.25, 'one extra letter in four: CER 0.25');
c = cer('', '');
near(c.cer, 0, 'empty against empty: CER 0');
c = cer('', 'ab');
near(c.cer, 1, 'empty reference, something said: CER 1');
c = cer('Don’t', "dont");
ok(c.cer > 0, 'an apostrophe is a letter for CER (don\'t is not dont)');

// pct
ok(pct(0) === '0.0%', 'pct(0)');
ok(pct(0.1234) === '12.3%', 'pct rounds to one decimal');
ok(pct(1) === '100.0%', 'pct(1)');
ok(pct(2) === '200.0%', 'pct above 1 is not capped');

console.log(`${pass} checks passed`);
