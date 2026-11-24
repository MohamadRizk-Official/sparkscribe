// lib/tool-settings.js: the cache key a Create tool's settings produce, defaults left out, instruction fingerprints,
// engine-2 key prefix and the quiz length numbers. Browser and server must agree on all of these.
import assert from 'node:assert/strict';
import * as T from '../src/lib/tool-settings.js';

let pass = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); pass++; console.log('ok -', m); };

eq(T.normalizeToolSettings('quiz').key, 'g2', 'default quiz settings give only the engine prefix');
eq(T.normalizeToolSettings('quiz', {}).settings, { size: 'standard', difficulty: 'standard', types: 'mixed' }, 'defaults fill every setting');
eq(T.normalizeToolSettings('quiz', { size: 'more', difficulty: 'harder', types: 'bogus', extra: 1 }), { settings: { size: 'more', difficulty: 'harder', types: 'mixed' }, key: 'g2;size=more;diff=harder' }, 'unknown values fall back to defaults, unknown fields are dropped, only non-defaults enter the key');
eq(T.normalizeToolSettings('quiz', null).key, 'g2', 'null settings are treated as defaults');
eq(T.normalizeToolSettings('flashcards', { explain: 'every', size: 'fewer' }).key, 'g2;size=fewer;expl=every', 'key parts follow the order of the settings spec, not of the input');
eq(T.normalizeToolSettings('study_guide', { focus: 'exam' }).key, 'g2;focus=exam', 'the study guide focus is part of the key');
eq(T.normalizeToolSettings('overview', { size: 'more' }), { settings: {}, key: '' }, 'a tool with no settings has an empty key');
eq(T.normalizeToolSettings('quiz', { size: '__proto__' }).settings.size, 'standard', 'inherited property names are not accepted as values');

const a = T.normalizeToolSettings('reply_draft', { instructions: '  Say   hi \n there ' });
eq(a.settings.instructions, 'Say hi there', 'instructions have their whitespace collapsed and trimmed');
eq(T.normalizeToolSettings('reply_draft', { instructions: 'Say hi there' }).key, a.key, 'the same instructions give the same key whatever the spacing');
ok(/^i=[0-9a-f]{8}$/.test(a.key), 'the key carries an 8-digit hex fingerprint of the instructions');
ok(a.key !== T.normalizeToolSettings('reply_draft', { instructions: 'Say bye' }).key, 'different instructions give different keys');
eq(T.normalizeToolSettings('reply_draft', {}).key, '', 'no instructions: empty key (results saved before settings existed still match)');
eq(T.normalizeToolSettings('followup_email', { instructions: 'x'.repeat(900) }).settings.instructions.length, T.MAX_INSTRUCTIONS, 'instructions are cut at the maximum length');
eq(T.normalizeToolSettings('flashcards', { instructions: 'ignored' }).settings.instructions, undefined, 'tools that take no instructions ignore them');

eq([T.isEngine2Key('g2'), T.isEngine2Key('g2;size=more'), T.isEngine2Key('size=more'), T.isEngine2Key(''), T.isEngine2Key(null)], [true, true, false, false, false], 'which keys belong to study engine 2');
eq([T.legacyKeyOf('g2;size=more'), T.legacyKeyOf('g2'), T.legacyKeyOf('size=more')], ['size=more', '', 'size=more'], 'the legacy key drops the engine prefix');
eq([...T.ENGINE2_TOOLS].sort(), ['flashcards', 'quiz', 'study_guide'], 'engine 2 covers flashcards, quizzes and study guides');

eq([T.quizQuestionCount(3, 'fewer'), T.quizQuestionCount(3, 'standard'), T.quizQuestionCount(3, 'more')], [3, 5, 8], 'a short recording asks 3 / 5 / 8 questions');
eq([T.quizQuestionCount(5, 'fewer'), T.quizQuestionCount(5, 'standard'), T.quizQuestionCount(5, 'more')], [5, 10, 15], 'from 5 minutes it asks 5 / 10 / 15');
eq(T.quizQuestionCount(60, 'unknown'), 10, 'an unknown size is the standard length');
eq(T.describeSettings('quiz', { size: 'more', difficulty: 'standard', types: 'true_false' }), 'Long · True / False', 'the label lists only non-default choices');
eq(T.describeSettings('reply_draft', { instructions: 'hi' }), 'with your instructions', 'instructions are mentioned without being repeated');
eq(T.describeSettings('quiz'), '', 'default settings have an empty label');
console.log(`${pass} checks passed`);
function ok(c, m) { assert.ok(c, m); pass++; console.log('ok -', m); }
