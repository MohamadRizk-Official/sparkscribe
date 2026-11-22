// Speaker-change continuation marks (src/lib/continuation.js): sentence-end detection, the 0.05 s gap rule, chains.
import assert from 'node:assert/strict';
const { continuationMarks } = await import(new URL('../src/lib/continuation.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const l = (start, end, speaker, text) => ({ start, end, speaker, text });
const cut = (a, b) => { const m = continuationMarks([a, b]); return m[0].cut && m[1].cont; };

ok(continuationMarks([]).length === 0, 'no lines gives no marks');
ok(continuationMarks([l(0, 1, 'A', 'hello')]).length === 1 && !continuationMarks([l(0, 1, 'A', 'hello')])[0].cut, 'a single line is never marked');

// ---- what counts as the end of a sentence
for (const end of ['.', '?', '!', '…']) ok(!cut(l(0, 1, 'A', `so we went home${end}`), l(1, 2, 'B', 'and slept')), `a part ending in "${end}" is finished, not cut`);
ok(!cut(l(0, 1, 'A', 'he said "go home."'), l(1, 2, 'B', 'and left')), 'a full stop inside closing quotes still ends the sentence');
ok(!cut(l(0, 1, 'A', 'it was (finally.)'), l(1, 2, 'B', 'and done')), 'a full stop inside a closing bracket still ends the sentence');
ok(!cut(l(0, 1, 'A', 'so we went home.   '), l(1, 2, 'B', 'and slept')), 'trailing spaces do not hide the full stop');
ok(cut(l(0, 1, 'A', 'so we went home,'), l(1, 2, 'B', 'and slept')), 'a comma is not the end of a sentence');
ok(cut(l(0, 1, 'A', 'so we went'), l(1, 2, 'B', 'home')), 'no punctuation at all: a cut');

// ---- the next part must start in lower case
ok(!cut(l(0, 1, 'A', 'so we went'), l(1, 2, 'B', 'Home was far')), 'a capitalised next part starts a new sentence');
ok(!cut(l(0, 1, 'A', 'so we went'), l(1, 2, 'B', '3 miles')), 'a digit does not continue the sentence');
ok(cut(l(0, 1, 'A', 'so we went'), l(1, 2, 'B', '  home')), 'leading spaces on the next part are ignored');

// ---- the gap rule: at most about 0.05 s between the end of one part and the start of the next
ok(cut(l(0, 1, 'A', 'so we'), l(1.04, 2, 'B', 'went')), 'a gap under 0.05 s counts as joined');
ok(!cut(l(0, 1, 'A', 'so we'), l(1.1, 2, 'B', 'went')), 'a gap over 0.05 s is a pause');
ok(cut(l(0, 1, 'A', 'so we'), l(0.96, 2, 'B', 'went')), 'a small overlap counts as joined');
ok(!cut(l(0, 1, 'A', 'so we'), l(0.5, 2, 'B', 'went')), 'a large overlap does not');

// ---- chains and untouched lines
const m = continuationMarks([l(0, 1, 'A', 'if you'), l(1, 2, 'B', 'ask me'), l(2, 3, 'C', 'then I would say'), l(3, 4, 'A', 'No.')]);
ok(m[0].cut && !m[0].cont, 'first part of a chain: cut only');
ok(m[1].cut && m[1].cont, 'middle part: both continues and is cut again');
ok(!m[2].cut && m[2].cont, 'last part of a chain: continues only');
ok(!m[3].cut && !m[3].cont, 'a new sentence after the chain is untouched');

// ---- bad data does not throw
ok(continuationMarks([l(0, 1, 'A', undefined), l(1, 2, 'B', null)]).length === 2, 'missing text does not throw');

console.log(`\n${pass} checks passed`);
