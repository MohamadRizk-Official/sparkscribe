// Study-map helpers (server/ai/studymap.js) not covered in studymap-test.mjs: cautionFor, lectureOverview, optionsLine,
// transcriptWordSet, and how verifyInstructions changes for a final re-check.
import assert from 'node:assert/strict';
const M = await import(new URL('../server/ai/studymap.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

// ---- cautionFor
ok(M.cautionFor(['Keynes']) === 'Check the recording: “Keynes” may be misheard in the automatic transcript.', 'one term is quoted in curly quotes');
ok(M.cautionFor(['Keynes', 'Hayek']).includes('“Keynes”, “Hayek”'), 'several terms are comma separated');

// ---- lectureOverview
const map = { concepts: [
  { name: 'Inflation', held_by: null, summary: 'Prices\n  rise   over time.' },
  { name: 'Monetarism', held_by: 'Friedman', summary: 'Money supply drives prices.' },
  { name: 'Odd', summary: undefined },
] };
const ov = M.lectureOverview(map).split('\n');
ok(ov[0] === '- Inflation: Prices rise over time.', 'a line per idea, with whitespace in the summary collapsed');
ok(ov[1] === '- Monetarism (Friedman): Money supply drives prices.', 'a holder is shown in brackets');
ok(ov[2] === '- Odd: ', 'a missing summary leaves an empty description');
ok(M.lectureOverview(null) === '' && M.lectureOverview({}) === '', 'no map gives an empty overview');
const big = { concepts: Array.from({ length: 500 }, (_, i) => ({ name: `Idea ${i}`, summary: 'x'.repeat(80) })) };
ok(M.lectureOverview(big).length === 9000, 'the overview is capped at 9000 characters');

// ---- optionsLine: lettered options for multiple choice and true/false only
ok(M.optionsLine({ type: 'multiple_choice', options: ['a1', 'b2', 'c3'] }) === 'Options: (A) a1  (B) b2  (C) c3\n', 'multiple choice options are lettered');
ok(M.optionsLine({ type: 'true_false' }) === 'Options: (A) True  (B) False\n', 'true/false always offers True and False');
ok(M.optionsLine({ type: 'short_answer', options: ['x'] }) === '', 'other item types have no options line');
ok(M.optionsLine({ type: 'multiple_choice', options: [] }) === '', 'multiple choice with no options gives nothing');

// ---- transcriptWordSet: lower-case, accents folded, hyphen parts added
const words = M.transcriptWordSet([{ text: 'Café Keynes — al-Khaldun said: GDP, 2024!' }, { text: 'O’Neill' }]);
ok(words.has('cafe') && words.has('keynes') && words.has('gdp') && words.has('2024'), 'words are lower-cased, accents folded and digits kept');
ok(words.has('al-khaldun') === false && words.has('al') && words.has('khaldun'), 'hyphenated names are split (the parts are known)');
ok(words.has('oneill'), 'apostrophes are removed inside a name');
ok(!words.has(''), 'no empty entries');
ok(M.transcriptWordSet([]).size === 0, 'an empty transcript has no words');

// ---- verifyInstructions
const first = M.verifyInstructions('quiz');
const final = M.verifyInstructions('quiz', { final: true });
ok(first.includes('quiz question') && M.verifyInstructions('flashcards').includes('flashcard'), 'the item name follows the kind');
ok(first.includes('fixed_question') && first.includes('set drop = true. Plain, grammatical wording'), 'the first check may propose fixes');
ok(final.includes('These items were already corrected once') && !final.includes('Plain, grammatical wording'), 'the final re-check accepts no fixes');
ok(!final.includes('If more than one option fits'), 'the final re-check has no rewording step for ambiguous options');
ok(!first.includes('<lecture_overview>'), 'no overview block unless one is given');
const withOv = M.verifyInstructions('quiz', { overview: '- Idea: text' });
ok(withOv.includes('<lecture_overview>\n- Idea: text\n</lecture_overview>'), 'a given overview is embedded in a block');
ok(first.includes('(then give fixed_question'), 'the clarity check asks for a clearer rewording in the first pass');
ok(!final.includes('(then give fixed_question, a clear rewording'), '…but not in the final re-check');
console.log(`${pass} checks passed`);
