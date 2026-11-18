// The shape of TOOL_SETTINGS (src/lib/tool-settings.js): every setting has a label, a default that is one of its own
// options, and every default produces the empty cache key. Instruction limits are pinned too.
//   node tests/tool-settings-spec-test.mjs
import assert from 'node:assert/strict';
import { TOOL_SETTINGS, TAKES_INSTRUCTIONS, INSTRUCTIONS_MISSING, MAX_INSTRUCTIONS, ENGINE2_TOOLS, normalizeToolSettings } from '../src/lib/tool-settings.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

ok(Object.keys(TOOL_SETTINGS).sort().join() === 'flashcards,quiz,study_guide', 'settings exist for flashcards, quiz and study guide');
for (const [tool, spec] of Object.entries(TOOL_SETTINGS)) {
  for (const [name, s] of Object.entries(spec)) {
    ok(typeof s.label === 'string' && s.label.length > 0, `${tool}.${name} has a label`);
    ok(Object.hasOwn(s.options, s.def), `${tool}.${name}: the default "${s.def}" is one of its options`);
    ok(Object.values(s.options).every((v) => typeof v === 'string' && v), `${tool}.${name}: every option has a display name`);
  }
}
ok(MAX_INSTRUCTIONS === 500, 'instructions are cut at 500 characters');
ok([...TAKES_INSTRUCTIONS].sort().join() === 'followup_email,reply_draft', 'only the reply draft and the follow-up email take instructions');
ok([...TAKES_INSTRUCTIONS].every((k) => typeof INSTRUCTIONS_MISSING[k] === 'string' && INSTRUCTIONS_MISSING[k]), 'each of them has a "missing instructions" message');
ok([...ENGINE2_TOOLS].sort().join() === 'flashcards,quiz,study_guide', 'the improved study engines cover exactly the three tools with settings');
for (const tool of Object.keys(TOOL_SETTINGS)) {
  const { key } = normalizeToolSettings(tool, {});
  ok(key === 'g2', `${tool}: all-default settings give only the engine key "g2"`);
}
console.log(`\n${pass} checks passed`);
