// fillInstructions and speakerNote (server/ai/study.js): the prompt that asks for one flashcard or question per
// concept that has none yet, and the speaker wording that follows. Text only; no AI is called.
//   node tests/study-fill-test.mjs
import assert from 'node:assert/strict';
import { STUDY_ENGINE, fillInstructions, speakerNote, EXPLAIN, QUIZ_TYPES, CONCEPT_KINDS, STANCES, QUIZ_SKILLS } from '../server/ai/study.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

const concepts = [
  { id: 'c1', name: 'Supply', kind: 'definition', stance: 'own', held_by: null, summary: 'How much is offered.', reasoning: 'Why it matters.', extra: 'NOT SENT' },
  { id: 'c4', name: 'Price floor', kind: 'principle', stance: 'attributed', held_by: 'S2', summary: 'A minimum price.', reasoning: null },
];

ok(STUDY_ENGINE === 2, 'this file is study engine 2');
ok(CONCEPT_KINDS.length === 8 && STANCES.length === 6 && QUIZ_SKILLS.length === 8, 'eight concept kinds, six stances and eight quiz skills');
ok(new Set(CONCEPT_KINDS).size === 8 && new Set(STANCES).size === 6 && new Set(QUIZ_SKILLS).size === 8, 'none of the lists repeats a value');

const cards = fillInstructions('flashcards', { concepts, settings: {}, dominant: null });
ok(/no flashcard yet\. Write exactly one flashcard for each/.test(cards), 'flashcards: asks for exactly one flashcard per concept');
ok(cards.includes('"id": "c1"') && cards.includes('"id": "c4"') && cards.includes('"held_by": "S2"'), 'the concepts are listed as JSON with their ids and who holds them');
ok(!cards.includes('NOT SENT'), 'only the concept fields the model needs are sent');
ok(cards.includes(EXPLAIN.helpful), 'flashcards: the default explanation rule is "when helpful"');
ok(!cards.includes('multiple_choice'), 'flashcards: no quiz wording');
ok(fillInstructions('flashcards', { concepts, settings: { explain: 'brief' } }).includes(EXPLAIN.brief), 'flashcards: the chosen explanation style is used');
ok(fillInstructions('flashcards', { concepts, settings: { explain: 'nonsense' } }).includes(EXPLAIN.helpful), 'flashcards: an unknown explanation style falls back to "when helpful"');

const quiz = fillInstructions('quiz', { concepts, settings: { types: 'true_false' }, dominant: null });
ok(/no question yet\. Write exactly one question for each/.test(quiz), 'quiz: asks for exactly one question per concept');
ok(quiz.includes(QUIZ_TYPES.true_false) && !quiz.includes(QUIZ_TYPES.mixed), 'quiz: the chosen question format is used');
ok(fillInstructions('quiz', { concepts, settings: {} }).includes('no true_false'), 'quiz: with no format chosen, true/false is not asked for');
ok(quiz.includes('"concept" = the concept\'s id'), 'the answer must name the concept by its id');

ok(speakerNote({ dominant: null }).includes('using their code in double braces'), 'no dominant speaker: speakers are named only when it matters, by code');
const lecture = speakerNote({ dominant: 'S1' });
ok(lecture.includes('{{S1}} gives almost all of the content') && lecture.includes('the lecturer'), 'a dominant speaker is "the lecturer", not named in every item');
ok(fillInstructions('quiz', { concepts, settings: {}, dominant: 'S1' }).endsWith(lecture), 'the speaker note closes the prompt');
console.log(`\n${pass} checks passed`);
