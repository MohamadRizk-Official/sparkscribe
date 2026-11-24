// Edge cases of lib/clean.js cleanText: what is removed, what must be kept, and that nothing vanishes.
import assert from 'node:assert/strict';
import { cleanText } from '../src/lib/clean.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const eq = (a, b, m) => { assert.equal(a, b, m); pass++; console.log('ok -', m); };

eq(cleanText(''), '', 'empty text is returned as is');
eq(cleanText('   '), '   ', 'whitespace-only text is returned as is');
eq(cleanText(null), '', 'null becomes an empty string');
eq(cleanText('Um, so we start.'), 'So we start.', 'a leading filler is dropped and the next word is capitalised');
eq(cleanText('We, uh, need more.'), 'We need more.', 'a filler between commas is removed with them');
eq(cleanText('the the cat'), 'the cat', 'a directly repeated word is collapsed');
eq(cleanText('no, no, no'), 'no, no, no', 'comma-separated emphasis is kept');
eq(cleanText('I think I think so'), 'I think so', 'a repeated short phrase is collapsed');
eq(cleanText('I- I think so'), 'I think so', 'a stutter fragment is removed');
eq(cleanText('2 2 apples'), '2 2 apples', 'repeated numbers are left alone');
eq(cleanText('I like it, you know, a lot'), 'I like it, you know, a lot', 'words that can carry meaning are kept');
eq(cleanText('umbrella and error'), 'umbrella and error', 'words that merely start with a filler are untouched');
eq(cleanText('Hmm.'), 'Hmm.', 'a line that is only filler stays visible');
const original = 'Um, the the plan';
cleanText(original);
eq(original, 'Um, the the plan', 'the input string is not modified');
console.log(`${pass} checks passed`);
