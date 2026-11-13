// sentenceOnsets and alignWords edge cases in src/lib/align-words.js (when each sentence of a paragraph starts).
import assert from 'node:assert/strict';
const W = await import(new URL('../src/lib/align-words.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); pass++; console.log('ok -', msg); };

const timed = [{ w: 'hello', s: 1, e: 1.3 }, { w: 'world', s: 1.4, e: 1.8 }, { w: 'this', s: 2.5, e: 2.7 }, { w: 'is', s: 2.8, e: 2.9 }];

eq(W.alignWords(['Hello', 'there', 'world'], timed), [0, -1, 1], 'a word with no counterpart maps to -1');
eq(W.alignWords(['HELLO,', 'World!'], timed), [0, 1], 'case and punctuation are ignored when matching');
eq(W.alignWords([], timed), [], 'no text words -> empty map');
eq(W.alignWords(['a', 'b'], []), [-1, -1], 'no timed words -> nothing matched');

eq(W.sentenceOnsets([{ text: 'Hello world.' }, { text: 'This is' }], timed), [1, 2.5], 'each sentence starts at its first matched word');
eq(W.sentenceOnsets([{ text: 'Hello world. ' }, { text: 'Oops this is' }], timed), [1, 2.25], 'a sentence whose first word is unmatched takes the next matched word, 0.25 s earlier per word skipped');
eq(W.sentenceOnsets([{ text: 'zzz' }], timed), [null], 'a sentence with no matched word is null');
eq(W.sentenceOnsets([{ text: 'a' }, { text: 'b' }], []), [null, null], 'no timed words -> every onset is null');
eq(W.sentenceOnsets([{ text: '  ' }], timed), [null], 'a blank sentence list is null');
ok(W.sentenceOnsets([{ text: 'Hello' }, { text: 'world' }, { text: 'this' }], timed).length === 3, 'one onset per sentence');
eq(W.sentenceOnsets([], timed), [], 'no sentences -> no onsets');

console.log(`${pass} checks passed`);
