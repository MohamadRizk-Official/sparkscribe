// Constants of the AI service (server/ai/service.js) and the retrieval budgets (server/ai/retrieve.js).
//   node tests/service-constants-test.mjs
import assert from 'node:assert/strict';
import { KINDS, STUDY_MAP_KEY } from '../server/ai/service.js';
import { FULL_CONTEXT_TOKENS, CONTEXT_BUDGET_TOKENS } from '../server/ai/retrieve.js';
import { normalizeSettings } from '../server/ai/tools.js';
import { normalizeToolSettings } from '../src/lib/tool-settings.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

ok(KINDS.join() === 'overview,detailed_summary,notes,insights', 'the stored analysis kinds, in order');
ok(new Set(KINDS).size === KINDS.length, 'no kind is listed twice');
ok(STUDY_MAP_KEY === 'g2', 'the study map is stored under the "g2" key');
ok(FULL_CONTEXT_TOKENS === 7000 && CONTEXT_BUDGET_TOKENS === 6000, 'full context is 7000 tokens; the retrieval budget is 6000');
ok(CONTEXT_BUDGET_TOKENS < FULL_CONTEXT_TOKENS, 'the retrieval budget is smaller than the size that fits whole');
ok(normalizeSettings === normalizeToolSettings, 'the server normalizes tool settings with the same function the browser uses');
console.log(`\n${pass} checks passed`);
