// Text normalisation for the accuracy metrics (src/lib/metrics.js normalizeText, words).
// Case, punctuation, Unicode forms and common Arabic spelling variants must not count as transcription errors.
import assert from 'node:assert/strict';
import { normalizeText, words } from '../src/lib/metrics.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); pass++; console.log('ok -', m); };

eq(normalizeText('Hello, World!'), 'hello world', 'case and punctuation are removed');
eq(normalizeText('  a   b \n c\t'), 'a b c', 'runs of whitespace collapse to one space and the ends are trimmed');
eq(normalizeText(null), '', 'null is the empty string');
eq(normalizeText(undefined), '', 'undefined is the empty string');
eq(normalizeText(42), '42', 'a number is read as text');
eq(normalizeText('don’t'), "don't", 'a curly apostrophe becomes a straight one');
eq(normalizeText("don`t"), "don't", 'a backtick apostrophe becomes a straight one');
eq(normalizeText("'quoted' word"), 'quoted word', 'quote marks at the edge of a word are dropped');
eq(normalizeText("rock 'n' roll"), 'rock n roll', 'a lone n between quotes loses its quotes');
eq(normalizeText('state-of-the-art'), 'state of the art', 'hyphens split words');
eq(normalizeText('3.14 and 2,000'), '3 14 and 2 000', 'punctuation inside numbers splits them');
eq(normalizeText('ﬁnd'), 'find', 'NFKC turns the "fi" ligature into two letters');
eq(normalizeText('ＡＢＣ'), 'abc', 'full-width letters become plain ones');
eq(normalizeText('café'), 'café', 'accented letters are kept');
eq(normalizeText('Straße'), 'straße', 'the German sharp s is kept');

// Arabic: spelling variants collapse to one form
eq(normalizeText('أحمد'), normalizeText('احمد'), 'alef with hamza above equals plain alef');
eq(normalizeText('إسلام'), normalizeText('اسلام'), 'alef with hamza below equals plain alef');
eq(normalizeText('مدرسة'), normalizeText('مدرسه'), 'taa marbuta equals haa');
eq(normalizeText('موسى'), normalizeText('موسي'), 'alef maqsura equals yaa');
eq(normalizeText('كتابٌ'), 'كتاب', 'diacritics are removed');
eq(normalizeText('كــتاب'), 'كتاب', 'tatweel (the elongation mark) is removed');
eq(normalizeText('مرحبا، كيف'), 'مرحبا كيف', 'the Arabic comma is punctuation');
ok(normalizeText('مدرسة', { arabic: false }) === 'مدرسة', 'with arabic: false the spelling variants are left alone');

// words
eq(words('One, two; three.'), ['one', 'two', 'three'], 'words splits normalised text');
eq(words(''), [], 'no text, no words');
eq(words('...'), [], 'only punctuation, no words');

console.log(`${pass} checks passed`);
