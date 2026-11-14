// Small study-engine helpers (server/ai/study.js) not covered in study-test.mjs: contentWords, lecturerWord, sameQuestion,
// uncoveredConcepts, inheritRefs, keepsAttribution.
import assert from 'node:assert/strict';
const S = await import(new URL('../server/ai/study.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

// ---- contentWords: lower-cased, stop words and 1-letter words dropped, speaker tokens ignored, words cut to 7 letters
ok(S.contentWords('The Cat IS on the mat').join() === 'cat,mat', 'stop words are removed and case is ignored');
ok(S.contentWords('{{S1}} explained inflation').join() === 'inflat', 'speaker tokens and "explained" are not content');
ok(S.contentWords('').length === 0 && S.contentWords(null).length === 0 && S.contentWords(undefined).length === 0, 'empty input gives no words');
ok(S.contentWords('running runs').join() === 'runn,run', 'endings are cut with a simple suffix rule (ing, ed, es, s, ly, ment, ness, ion)');
ok(S.contentWords('Prices, prices!').join() === 'pric,pric', 'punctuation separates words and a trailing "es" is stemmed away');
ok(S.contentWords('cannot not no').join() === 'cannot,not,no', 'negations are kept (see the comment above STOP)');
ok(S.contentWords('X can replace Y').join() === 'can,replace' && S.contentWords('X cannot replace Y').join() === 'cannot,replace', '"can" and "cannot" stay, so opposite questions differ');
ok(S.contentWords('internationalization').join() === 'interna', 'long words are cut to 7 characters');

// ---- lecturerWord: the dominant speaker becomes "the lecturer"
ok(S.lecturerWord('{{S1}} said so', 'S1') === 'the lecturer said so', 'the dominant speaker token is replaced');
ok(S.lecturerWord('{{S2}} said so', 'S1') === '{{S2}} said so', 'other speakers are left alone');
ok(S.lecturerWord('{{S1}} said so', null) === '{{S1}} said so', 'no dominant speaker: unchanged');
ok(S.lecturerWord('{{S1}} and {{S1}}', 'S1') === 'the lecturer and the lecturer', 'every occurrence is replaced');

// ---- sameQuestion: word overlap of at least 0.7, unless two different speakers are named
ok(S.sameQuestion('What is the capital of France?', 'what is the capital of france') === true, 'the same question is a duplicate');
ok(S.sameQuestion('What causes inflation to rise?', 'Why do photosynthesis reactions occur?') === false, 'unrelated questions are not');
ok(S.sameQuestion('What did {{S2}} propose?', 'What did {{S3}} propose?') === false, 'two speakers\' viewpoints are two questions');
ok(S.sameQuestion('What did {{S2}} propose?', 'What did {{S2}} propose?') === true, 'the same speaker and wording is a duplicate');
ok(S.sameQuestion('', '') === false, 'two empty strings are not duplicates');

// ---- uncoveredConcepts
const concepts = [
  { id: 'a', importance: 'core', clarity: 'clear' },
  { id: 'b', importance: 'core', clarity: 'unreliable' },
  { id: 'c', importance: 'supporting', clarity: 'clear' },
  { id: 'd', importance: 'core', clarity: 'clear' },
];
ok(S.uncoveredConcepts(concepts, []).map((k) => k.id).join() === 'a,d', 'with no items, the reliable core concepts are uncovered');
ok(S.uncoveredConcepts(concepts, [{ concept: 'a' }]).map((k) => k.id).join() === 'd', 'a concept an item tests is covered');
ok(S.uncoveredConcepts(concepts, [{ concept: 1 }, { concept: 'a' }]).length === 1, 'concept ids are compared as strings');
ok(S.uncoveredConcepts(concepts, [], { supporting: true }).map((k) => k.id).join() === 'a,d,c', 'with supporting: core first, then supporting');
ok(S.uncoveredConcepts(null, null).length === 0, 'missing lists are fine');

// ---- inheritRefs: items without lines take their concept's lines
const content = { concepts: [{ id: 'a', refs: [1, 2] }, { id: 'b', refs: [9] }] };
const items = [{ concept: 'a' }, { concept: 'b', refs: [4] }, { concept: 'zzz' }, { concept: 'a', refs: [] }];
S.inheritRefs(items, content);
ok(items[0].refs.join() === '1,2', 'an item with no refs inherits its concept\'s');
ok(items[1].refs.join() === '4', 'an item with its own refs keeps them');
ok(items[2].refs.length === 0, 'an unknown concept gives an empty list');
ok(items[3].refs.join() === '1,2', 'an empty refs list counts as missing');
ok(items[0].refs !== content.concepts[0].refs, 'the concept\'s array is copied, not shared');
S.inheritRefs(null, content); S.inheritRefs([], {});
ok(true, 'null items and empty content do not throw');

// ---- keepsAttribution
const attributed = { stance: 'attributed', held_by: 'Piaget' };
ok(S.keepsAttribution({ question: 'What is X?' }, { stance: 'own', held_by: 'Piaget' }) === true, 'the speaker\'s own claims need no attribution');
ok(S.keepsAttribution({ question: 'What is X?' }, null) === true, 'no concept: nothing to check');
ok(S.keepsAttribution({ question: 'What is X?' }, { stance: 'attributed', held_by: '' }) === true, 'no holder recorded: nothing to check');
ok(S.keepsAttribution({ question: 'What did Piaget say about stages?', answer: 'Four.' }, attributed) === true, 'naming the holder keeps it');
ok(S.keepsAttribution({ question: 'What are the stages?', answer: 'Four.' }, attributed) === false, 'dropping the holder does not');
ok(S.keepsAttribution({ question: 'What are the stages according to piaget’s theory?', answer: '4' }, attributed) === true, 'matching is case-insensitive');
ok(S.keepsAttribution({ question: 'What does {{S2}} claim?' }, { stance: 'attributed', held_by: '{{S2}}' }) === true, 'a participant token in the item satisfies a participant holder');
ok(S.keepsAttribution({ question: 'What is claimed?' }, { stance: 'attributed', held_by: '{{S2}}' }) === false, 'a participant holder with no token in the item fails');
ok(S.keepsAttribution({ question: 'What is claimed?' }, { stance: 'attributed', held_by: '{{S1}}' }, 'S1') === true, 'the dominant speaker\'s view is the lecturer\'s own');
const crit = { stance: 'criticized', held_by: 'Behaviourism' };
ok(S.keepsAttribution({ type: 'true_false', front: 'True or false: X always holds', answer: 'False' }, crit) === true, 'a false true/false item tests the rejected claim itself');
ok(S.keepsAttribution({ type: 'mcq', question: 'Does X always hold?', answer: 'No. It fails.' }, crit) === true, 'answering "No" is the criticism');
ok(S.keepsAttribution({ question: 'What is the main problem with this view?', answer: 'It ignores thought.' }, crit) === true, 'a criticized view may say it is criticized instead of naming the holder');
ok(S.keepsAttribution({ question: 'What is the view?', answer: 'Behaviour is learned.' }, crit) === true, 'the holder\'s stem matches ("Behaviourism" in the text)');
ok(S.keepsAttribution({ question: 'What is the view?', answer: 'Learning is stimulus and response.' }, { stance: 'attributed', held_by: 'Skinner' }) === false, 'an attributed view with no holder named fails');
console.log(`${pass} checks passed`);
