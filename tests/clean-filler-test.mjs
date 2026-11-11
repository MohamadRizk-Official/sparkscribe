// Clean reading view, hesitation sounds (src/lib/clean.js cleanText): fillers go, meaningful words and edge cases stay.
import assert from 'node:assert/strict';
const { cleanText } = await import(new URL('../src/lib/clean.js', import.meta.url).href);

let pass = 0;
const eq = (input, want, msg) => { assert.equal(cleanText(input), want, msg); pass++; console.log('ok -', msg); };

eq('Um, so I think we should go.', 'So I think we should go.', 'a leading "um," is dropped and the next word capitalised');
eq('erm the thing is', 'The thing is', 'a leading "erm" is dropped');
eq('Uh... well, okay', 'Well, okay', 'a leading "uh..." with ellipsis is dropped');
eq('We, uh, need more time.', 'We need more time.', 'a filler between commas is removed with its commas');
eq('I was, um, going to say it.', 'I was going to say it.', '"um" mid-sentence is removed');
eq('First point. Uh, second point.', 'First point. Second point.', 'a filler at the start of a later sentence is removed');
eq('Hello world', 'Hello world', 'text without fillers is untouched');
eq('So, like, you know, I mean it.', 'So, like, you know, I mean it.', 'words that can carry meaning (like, you know, I mean) are kept');
eq('There is no way', 'There is no way', 'negations are kept');
eq('Summer is here', 'Summer is here', 'words that merely contain "um" are not touched');
eq('The ahead plan', 'The ahead plan', 'words that start with a filler sound are not touched');

// lines that are only filler stay visible
eq('hmm', 'hmm', 'a line that is only a filler is returned as it was');
eq('Um...', 'Um...', 'a line of only a filler and punctuation is returned as it was');

// empty input
eq('', '', 'empty text stays empty');
eq('   ', '   ', 'whitespace-only text is returned as it was');
assert.equal(cleanText(null), ''); pass++; console.log('ok - null becomes an empty string');
assert.equal(cleanText(undefined), ''); pass++; console.log('ok - undefined becomes an empty string');
assert.equal(cleanText(42), '42'); pass++; console.log('ok - non-strings are converted to text');

// idempotent
const once = cleanText('Um, we, uh, uh, need the the plan.');
assert.equal(cleanText(once), once); pass++; console.log('ok - cleaning twice gives the same result as once');

console.log(`${pass} checks passed`);
