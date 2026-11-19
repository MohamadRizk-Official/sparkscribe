// The system prompts in server/ai/prompts.js: the transcript analyst and the Ask prompt both carry the shared
// "exact meaning" and speaker rules verbatim, and the analyst must be told how to cite lines. Wording that product
// behaviour depends on is checked by meaning, not by whole sentences, so small edits do not break it.
//   node tests/prompts-system-test.mjs
import assert from 'node:assert/strict';
import { SPEAKER_RULE, MEANING_RULES, ANALYST_SYSTEM, ASK_SYSTEM, GRADE_SYSTEM } from '../server/ai/prompts.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

ok(ANALYST_SYSTEM.includes(MEANING_RULES) && ANALYST_SYSTEM.includes(SPEAKER_RULE), 'the analyst prompt contains the shared meaning and speaker rules unchanged');
ok(ASK_SYSTEM.includes(MEANING_RULES) && ASK_SYSTEM.includes(SPEAKER_RULE), 'the Ask prompt contains the shared meaning and speaker rules unchanged');
ok(/work only from the transcript/i.test(ANALYST_SYSTEM), 'the analyst works only from the transcript it is given');
ok(/recognition mistakes/.test(ANALYST_SYSTEM) && /recognition mista/.test(ASK_SYSTEM), 'both prompts warn that the transcript can contain recognition mistakes');
ok(/"refs"/.test(ANALYST_SYSTEM) && /Never cite a line number that does not appear/.test(ANALYST_SYSTEM), 'the analyst must cite line numbers and never invent one');
ok(/Never attach a name to a speaker label/.test(SPEAKER_RULE), 'a speaker label is never given a name by the model');
ok(/quotation marks only around words copied exactly/i.test(MEANING_RULES), 'quotation marks are for exact words only');
ok(/Never open with "Based on the transcript/.test(ASK_SYSTEM), 'Ask answers start with the answer, not with "Based on the transcript"');
ok(/Write in the language of the question/.test(ASK_SYSTEM), 'Ask answers in the language of the question');
ok(/strictly faithful to what the recording says/.test(GRADE_SYSTEM) && GRADE_SYSTEM.length < 300, 'the grader is short and faithful to the recording');
ok([SPEAKER_RULE, MEANING_RULES, ANALYST_SYSTEM, ASK_SYSTEM, GRADE_SYSTEM].every((s) => typeof s === 'string' && s.trim() === s && s.length > 50), 'every prompt is a trimmed, non-trivial string');
console.log(`\n${pass} checks passed`);
