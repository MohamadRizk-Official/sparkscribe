// Extra cases for server/ai/grounding.js (beyond service-test.mjs): cleanRefs, quote checks, chapter rules, groundAnswer counts.
import assert from 'node:assert/strict';
const G = await import(new URL('../server/ai/grounding.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); pass++; console.log('ok -', msg); };

// ---- cleanRefs
const any = () => true;
eq(G.cleanRefs([5, 3, 3, 9], any), [3, 5, 9], 'refs are de-duplicated and sorted');
eq(G.cleanRefs(['4', 2.5, 'x', -1, 7], any), [-1, 4, 7], 'strings of digits are accepted, fractions and text are dropped');
eq(G.cleanRefs([1, 2, 3, 4, 5, 6, 7], any), [1, 2, 3, 4, 5], 'at most 5 refs are kept (the first five seen)');
eq(G.cleanRefs([9, 8, 7, 6, 5, 4, 3], any), [5, 6, 7, 8, 9], 'the cap applies before sorting');
eq(G.cleanRefs([1, 2, 3], (id) => id !== 2), [1, 3], 'refs the validator rejects are dropped');
eq(G.cleanRefs('1,2', any), [], 'a non-array is no refs');
eq(G.cleanRefs(undefined, any), [], 'undefined is no refs');

// ---- groundStructured
const segments = [
  { id: 0, start: 0, text: 'We should talk about the budget first.' },
  { id: 1, start: 10, text: 'Agreed, the budget is tight this year' },
  { id: 2, start: 20, text: 'and we must cut costs by ten percent.' },
  { id: 3, start: 30, text: 'Okay.' },
];
let r = G.groundStructured({ quotes: [{ quote: 'the budget is tight this year', refs: [1] }] }, segments);
ok(r.content.quotes.length === 1 && r.dropped === 0, 'a quote found word for word in its cited line is kept');
r = G.groundStructured({ quotes: [{ quote: 'The BUDGET, is tight; this year!', refs: [1] }] }, segments);
ok(r.content.quotes.length === 1, 'quote matching ignores case and punctuation');
r = G.groundStructured({ quotes: [{ quote: 'tight this year and we must cut costs', refs: [1] }] }, segments);
ok(r.content.quotes.length === 1, 'a quote may run into the neighbouring line');
r = G.groundStructured({ quotes: [{ quote: 'cut costs by ten percent', refs: [0] }] }, segments);
ok(r.content.quotes.length === 0 && r.dropped === 1, 'a quote from a line two away from the cited one is dropped');
r = G.groundStructured({ quotes: [{ quote: 'budget', refs: [0] }] }, segments);
ok(r.content.quotes.length === 0, 'a one-word quote is never accepted');
r = G.groundStructured({ quotes: [{ quote: 'invented words entirely', refs: [1] }] }, segments);
ok(r.content.quotes.length === 0, 'a quote that is not in the lines is dropped');
r = G.groundStructured({ points: [{ text: ' padded ', refs: [99, 1] }] }, segments);
ok(r.content.points[0].text === 'padded' && r.content.points[0].refs.join() === '1', 'strings are trimmed and invalid refs removed from kept items');
r = G.groundStructured({ points: [{ text: 'no valid line', refs: [42] }] }, segments);
ok(r.content.points.length === 0 && r.dropped === 1, 'an item whose refs are all invalid is dropped and counted');
r = G.groundStructured({ title: ' Hello ', n: 3 }, segments);
ok(r.content.title === 'Hello' && r.content.n === 3 && r.dropped === 0, 'plain fields without refs pass through (strings trimmed)');

// ---- groundChapters
const long = Array.from({ length: 8 }, (_, i) => ({ id: i, start: i * 30, text: 't' + i }));
const ch = (title, ref) => ({ title, summary: ' s ', start_ref: ref });
eq(G.groundChapters([ch('A', 0), ch('B', 4)], long).map((c) => c.start_ref), [0, 4], 'two valid chapters are kept');
eq(G.groundChapters([ch('A', 2), ch('B', 5)], long).map((c) => c.start_ref), [0, 5], 'the first chapter is moved to the first line of the recording');
const dense = Array.from({ length: 8 }, (_, i) => ({ id: i, start: i * 10, text: 't' + i }));
eq(G.groundChapters([ch('A', 1), ch('B', 2)], dense), [], 'a chapter starting less than 20 s after the previous one is merged away, leaving one -> none');
eq(G.groundChapters([ch('A', 1), ch('B', 3)], dense).map((c) => c.title), ['A', 'B'], 'a chapter exactly 20 s after the previous one is kept');
eq(G.groundChapters([ch('Only', 3)], long), [], 'a single chapter is not worth showing');
eq(G.groundChapters([ch('', 1), ch('  ', 2), ch('A', 3), ch('B', 6)], long).map((c) => c.title), ['A', 'B'], 'chapters without a title are dropped');
ok(G.groundChapters([ch('A', 0), ch('B', 4)], long)[0].summary === 's', 'summaries are trimmed');
eq(G.groundChapters('nope', long), [], 'a non-array gives no chapters');
eq(G.groundChapters([ch('A', 0), ch('B', 4)], []), [], 'no segments gives no chapters');

// ---- groundAnswer
const a = G.groundAnswer('Due Friday [1][7][8].', [1]);
ok(a.invalidCitations === 2 && a.refs.join() === '1', 'groundAnswer counts the citations it removed');
ok(a.found === true && a.unsupported === false, 'an answer that keeps a valid citation is found and supported');
const none = G.groundAnswer('', [1]);
ok(none.answer === '' && none.refs.length === 0, 'empty text gives an empty answer');
ok(G.groundAnswer('Only invalid [9].', [1]).unsupported === true, 'an answer whose only citation was invalid becomes unsupported');

console.log(`${pass} checks passed`);
