// server/entitlements.js requireCapability: unknown capability, plan unavailable, entitled, and refusals naming plans.
import assert from 'node:assert/strict';
import { CAPABILITIES, requireCapability } from '../server/entitlements.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const rejects = async (p, check, m) => { let e; try { await p; } catch (x) { e = x; } assert.ok(e, m + ' (should throw)'); check(e); pass++; console.log('ok -', m); };

ok(Object.isFrozen(CAPABILITIES), 'the capability table is frozen');
ok(['focused_review', 'followup_practice', 'across_ask', 'across_guide'].every((k) => CAPABILITIES[k].label), 'every capability has a label');

await rejects(requireCapability({ entitlements: async () => ({ features: [] }) }, 'nope'), (e) => assert.match(e.message, /unknown capability/), 'an unknown capability throws');
await rejects(requireCapability({}, 'across_ask'), (e) => assert.ok(e.status === 503 && e.code === 'plan_unavailable'), 'no entitlements function: refused as plan_unavailable');
await rejects(requireCapability({ entitlements: async () => { throw new Error('db down'); } }, 'across_ask'), (e) => assert.equal(e.code, 'plan_unavailable'), 'a failing plan lookup is refused, never treated as entitled');
await rejects(requireCapability({ entitlements: async () => ({ plan: 'free' }) }, 'across_ask'), (e) => assert.equal(e.code, 'plan_unavailable'), 'a result without a features list is refused');

const e1 = { plan: 'bolt', features: ['focused_review'] };
ok((await requireCapability({ entitlements: async () => e1 }, 'focused_review')) === e1, 'an entitled user gets the entitlements back');

const plans = [
  { key: 'thunder', name: 'Thunder', tier: 3, features: ['across_ask', 'focused_review'] },
  { key: 'bolt', name: 'Bolt', tier: 2, features: ['focused_review'] },
  { key: 'x', name: 'Odd', tier: null, features: ['across_ask'] },
];
await rejects(requireCapability({ entitlements: async () => ({ plan: 'free', features: [], plans }) }, 'focused_review'), (e) => {
  assert.equal(e.status, 403); assert.equal(e.code, 'plan_required');
  assert.match(e.message, /Focused Review is included with Bolt and Thunder\. Nothing was used\./);
  assert.deepEqual(e.details, { capability: 'focused_review', plan: 'bolt', planName: 'Bolt', current: 'free' });
}, 'a refusal names the plans that include it, lowest tier first');
await rejects(requireCapability({ entitlements: async () => ({ plan: 'free', features: [], plans }) }, 'across_guide'), (e) => {
  assert.match(e.message, /Combined study guides are included with a higher plan/);
  assert.equal(e.details.plan, null);
}, 'a plural capability uses "are", and no plan having it says "a higher plan"');
console.log(`${pass} checks passed`);
