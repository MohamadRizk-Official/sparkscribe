// Clean reading view, repetitions and stutters (src/lib/clean.js cleanText).
import assert from 'node:assert/strict';
const { cleanText } = await import(new URL('../src/lib/clean.js', import.meta.url).href);

let pass = 0;
const eq = (input, want, msg) => { assert.equal(cleanText(input), want, msg); pass++; console.log('ok -', msg); };

eq('the the cat sat', 'the cat sat', 'an immediately repeated word is collapsed');
eq('I think, I think it works', 'I think it works', 'a repeated phrase with a comma is collapsed');
eq('I think I think I think so', 'I think so', 'a phrase repeated several times is collapsed to one');
eq('no, no, no, it is fine', 'no, no, no, it is fine', 'emphasis with commas ("no, no, no") is kept');
eq('very, very important', 'very, very important', 'a comma-separated single word repeat is kept');
eq('I have 2 2 cats', 'I have 2 2 cats', 'repeated numbers are left alone');
eq('I- I think so.', 'I think so.', 'a stutter fragment "I-" is removed');
eq('w- we went', 'we went', 'a partial-word stutter is removed');
eq('t- hello there', 't- hello there', 'a fragment that does not start the next word is kept');
eq('Mm-hmm that is right', 'that is right', '"Mm-hmm" at the start is treated as a hesitation sound');
eq('That that is right', 'That is right', 'repeats are matched case-insensitively');
eq("don't don't go", "don't go", 'apostrophes are part of a word when collapsing repeats');
eq('café café menu', 'café menu', 'repeated accented words are collapsed');
eq('the cat', 'the cat', 'no repetition leaves text unchanged');
eq('is is', 'is', 'a line of one repeated word keeps one copy');

console.log(`${pass} checks passed`);
