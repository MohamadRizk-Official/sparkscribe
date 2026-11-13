// Sentence splitting and paragraph lookup in src/lib/breath.js: splitSentences and paragraphIndexAt.
import assert from 'node:assert/strict';
const B = await import(new URL('../src/lib/breath.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const texts = (s) => B.splitSentences(s).map((x) => x.text.trim());

ok(JSON.stringify(texts('One. Two! Three?')) === JSON.stringify(['One.', 'Two!', 'Three?']), 'splits on . ! ?');
ok(texts('Hello Dr. Smith is here. Bye.').length === 2, 'a title abbreviation (Dr.) does not end a sentence');
ok(texts('See e.g. the notes. Done.').length === 2, 'e.g. does not end a sentence');
ok(texts('It costs 3.5 dollars. Fine.').length === 2, 'a decimal point does not end a sentence');
ok(texts('Plan A. Then plan B.').length === 1, 'a lone letter before a full stop is treated as an initial, so "Plan A." is kept with what follows');
ok(texts('Really?! Yes.').length === 2, 'runs of punctuation count as one ending');
ok(texts('He said "stop." Then left.').length === 2, 'a closing quote stays with its sentence');
ok(texts('No ending here').length === 1 && texts('No ending here')[0] === 'No ending here', 'text without a full stop is one sentence');

const r = B.splitSentences('First one. Second one.');
ok(r[0].at === 0 && r[1].at === 'First one. '.length, '`at` is the character offset where each sentence starts');
ok(r.map((x) => x.text).join('') === 'First one. Second one.', 'the sentences join back to the original text');

const empty = B.splitSentences('');
ok(empty.length === 1 && empty[0].text === '' && empty[0].at === 0, 'empty text gives one empty sentence');
ok(B.splitSentences(null).length === 1 && B.splitSentences(undefined)[0].text === '', 'null / undefined are treated as empty');

const segs = [{ start: 0 }, { start: 10 }, { start: 20 }];
ok(B.paragraphIndexAt(segs, 0) === 0, 'time 0 is the first paragraph');
ok(B.paragraphIndexAt(segs, 10) === 1, 'a paragraph start belongs to that paragraph');
ok(B.paragraphIndexAt(segs, 9.96) === 1, 'within 0.05 s before a start counts as that paragraph');
ok(B.paragraphIndexAt(segs, 15) === 1 && B.paragraphIndexAt(segs, 99) === 2, 'times inside / past the end map to the latest start');
ok(B.paragraphIndexAt([{ start: 5 }], 1) === -1, 'before the first paragraph is -1');
ok(B.paragraphIndexAt([], 3) === -1, 'no paragraphs is -1');

console.log(`${pass} checks passed`);
