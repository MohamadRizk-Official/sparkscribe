// Create-tab tool settings and cache keys (src/lib/tool-settings.js).
import assert from 'node:assert/strict';
const T = await import(new URL('../src/lib/tool-settings.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

// ---- quizQuestionCount ----
ok(T.quizQuestionCount(30, 'standard') === 10 && T.quizQuestionCount(30, 'fewer') === 5 && T.quizQuestionCount(30, 'more') === 15, 'long recordings: 5 / 10 / 15 questions');
ok(T.quizQuestionCount(3, 'standard') === 5 && T.quizQuestionCount(3, 'fewer') === 3 && T.quizQuestionCount(3, 'more') === 8, 'recordings under 5 minutes: 3 / 5 / 8 questions');
ok(T.quizQuestionCount(5, 'standard') === 10, 'exactly 5 minutes counts as a long recording');
ok(T.quizQuestionCount(30, undefined) === 10, 'an unknown size is the standard length');

// ---- normalizeToolSettings: keys ----
let n = T.normalizeToolSettings('flashcards', {});
ok(n.key === 'g2' && n.settings.size === 'standard', 'default flashcards settings give just the engine key "g2"');
n = T.normalizeToolSettings('flashcards', { size: 'more', focus: 'bogus' });
ok(n.key === 'g2;size=more' && n.settings.focus === 'balanced', 'non-default choices go in the key, unknown values fall back to defaults');
n = T.normalizeToolSettings('quiz', { difficulty: 'harder', types: 'true_false' });
ok(n.key === 'g2;diff=harder;types=true_false', 'quiz key lists changed settings in a fixed order');
ok(T.normalizeToolSettings('study_guide', { focus: 'exam' }).key === 'g2;focus=exam', 'study guide focus is part of its key');
n = T.normalizeToolSettings('summary', {});
ok(n.key === '' && Object.keys(n.settings).length === 0, 'a tool without settings has the empty key');
ok(T.normalizeToolSettings('flashcards').key === 'g2', 'raw settings are optional');
ok(T.normalizeToolSettings('flashcards', null).key === 'g2', 'null raw settings are treated as defaults');
ok(T.normalizeToolSettings('quiz', { size: '__proto__' }).settings.size === 'standard', 'prototype property names are not accepted as option values');

// ---- instructions (drafts) ----
n = T.normalizeToolSettings('reply_draft', { instructions: '  say   yes ' });
ok(n.settings.instructions === 'say yes', 'instructions have whitespace collapsed and trimmed');
ok(n.key === T.normalizeToolSettings('reply_draft', { instructions: 'say yes' }).key, 'the key does not depend on spacing');
ok(T.normalizeToolSettings('reply_draft', { instructions: 'x' }).key === 'i=fd0c5087', 'instruction fingerprint is stable (FNV-1a of "x"); changing it would orphan stored drafts');
ok(T.normalizeToolSettings('followup_email', {}).key === '', 'empty instructions leave the key empty');
ok(T.normalizeToolSettings('reply_draft', { instructions: 'a'.repeat(600) }).settings.instructions.length === T.MAX_INSTRUCTIONS, 'instructions are cut at MAX_INSTRUCTIONS');
ok(T.TAKES_INSTRUCTIONS.has('reply_draft') && T.TAKES_INSTRUCTIONS.has('followup_email') && !T.TAKES_INSTRUCTIONS.has('quiz'), 'only drafts take instructions');
ok(Object.keys(T.INSTRUCTIONS_MISSING).every((k) => T.TAKES_INSTRUCTIONS.has(k)), 'every "instructions missing" message belongs to a draft tool');

// ---- engine keys ----
ok(T.isEngine2Key('g2') && T.isEngine2Key('g2;size=more') && !T.isEngine2Key('g22') && !T.isEngine2Key('size=more') && !T.isEngine2Key(null), 'isEngine2Key recognises only the g2 prefix');
ok(T.legacyKeyOf('g2;size=more') === 'size=more' && T.legacyKeyOf('g2') === '' && T.legacyKeyOf('size=more') === 'size=more', 'legacyKeyOf strips the engine prefix');
ok(T.ENGINE2_TOOLS.has('flashcards') && T.ENGINE2_TOOLS.has('quiz') && T.ENGINE2_TOOLS.has('study_guide'), 'flashcards, quiz and study guide use engine keys');

// ---- describeSettings ----
ok(T.describeSettings('quiz', { size: 'more', difficulty: 'harder', types: 'mixed' }) === 'Long · Challenge', 'labels of non-default choices, joined with " · "');
ok(T.describeSettings('quiz', {}) === '' && T.describeSettings('quiz') === '', 'defaults describe as an empty string');
ok(T.describeSettings('reply_draft', { instructions: 'x' }) === 'with your instructions', 'instructions are mentioned in the label');
ok(T.describeSettings('nope', { size: 'more' }) === '', 'an unknown tool describes as empty');

console.log(`${pass} checks passed`);
