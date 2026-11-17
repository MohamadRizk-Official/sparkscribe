// Prompt builders for flashcards and quizzes (server/ai/study.js): the count ceiling, settings, speaker notes and shared rules.
import assert from 'node:assert/strict';
const S = await import(new URL('../server/ai/study.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

// ---- shared rules ----
ok(S.STYLE_RULES.includes('Self-contained') && S.STYLE_RULES.includes('Attribution'), 'the style rules cover self-contained wording and attribution');
ok(/supported by the recording/.test(S.STYLE_RULES), 'the style rules forbid claims the recording does not support');

// ---- speakerNote ----
const noDom = S.speakerNote({ dominant: null });
ok(noDom.includes('only when it matters') && !noDom.includes('lecturer'), 'with no dominant speaker, speakers are named only when it matters');
const dom = S.speakerNote({ dominant: 'S1' });
ok(dom.includes('{{S1}} gives almost all of the content'), 'a dominant speaker is named by code');
ok(dom.includes('"the lecturer"') && dom.includes('never write "According to {{S1}}"'), 'a dominant speaker is replaced by "the lecturer" in questions');

// ---- flashcards ----
const fc = S.flashcardInstructions({ count: 12, settings: {}, dominant: null });
ok(fc.startsWith('Make FLASHCARDS'), 'flashcard instructions say what to make');
ok(fc.includes('At most 12 cards') && fc.includes('a ceiling, not a target'), 'the card count is a ceiling');
ok(fc.includes(S.STYLE_RULES), 'flashcards include the shared style rules');
ok(fc.includes(S.FOCUS.balanced) && fc.includes(S.EXPLAIN.helpful), 'default settings use balanced focus and helpful explanations');
const fc2 = S.flashcardInstructions({ count: 5, settings: { focus: 'definitions', explain: 'none' }, dominant: 'S2' });
ok(!fc2.includes('At most 12') && fc2.includes('At most 5 cards'), 'a different count is used as given');
ok(fc2.includes('{{S2}} gives almost all'), 'the dominant speaker note is added to flashcards');
const fc3 = S.flashcardInstructions({ count: 5, settings: { focus: 'not-a-focus', explain: 'nope' } });
ok(fc3.includes(S.FOCUS.balanced) && fc3.includes(S.EXPLAIN.helpful), 'unknown focus and explain values fall back to the defaults');
ok(S.flashcardInstructions({ count: 3 }).includes('At most 3 cards'), 'settings may be left out entirely');

// ---- quiz ----
const q = S.quizInstructions({ count: 15, settings: {}, dominant: null });
ok(q.startsWith('Write a PRACTICE QUIZ'), 'quiz instructions say what to make');
ok(q.includes('At most 15 questions'), 'the question count is a ceiling');
ok(q.includes(S.QUIZ_TYPES.mixed) && q.includes('Standard level'), 'defaults are mixed types at standard level');
ok(q.includes('exactly 4 options'), 'multiple-choice questions need exactly 4 options');
ok(q.includes(S.STYLE_RULES), 'the quiz includes the shared style rules');
const qh = S.quizInstructions({ count: 10, settings: { difficulty: 'harder', types: 'multiple_choice' }, dominant: null });
ok(qh.includes('Challenge level') && qh.includes(S.QUIZ_TYPES.multiple_choice), 'harder difficulty and a single type are applied');
ok(!qh.includes('Standard level'), 'harder difficulty replaces the standard level text');
const qt = S.quizInstructions({ count: 10, settings: { types: 'true_false' }, dominant: null });
ok(qt.includes('false_statement'), 'true/false questions ask for a false version');
ok(S.quizInstructions({ count: 10, settings: { types: 'bogus' } }).includes(S.QUIZ_TYPES.mixed), 'an unknown type falls back to mixed');

console.log(`${pass} checks passed`);
