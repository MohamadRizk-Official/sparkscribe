// Plan gating on the server (server/entitlements.js): CAPABILITIES and requireCapability.
import assert from 'node:assert/strict';
const E = await import(new URL('../server/entitlements.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const fails = async (p) => { try { await p; return null; } catch (e) { return e; } };

ok(Object.isFrozen(E.CAPABILITIES), 'the capability table is frozen');
ok(['focused_review', 'followup_practice', 'across_ask', 'across_guide'].every((k) => E.CAPABILITIES[k]), 'the four premium capabilities exist');

const plans = [
  { key: 'thunder', name: 'Thunder', tier: 3, features: ['focused_review', 'across_ask', 'across_guide', 'followup_practice'] },
  { key: 'bolt', name: 'Bolt', tier: 2, features: ['focused_review', 'followup_practice'] },
  { key: 'free', name: 'Free', tier: 0, features: [] },
  { key: 'odd', name: 'Odd', tier: null, features: ['across_ask'] },
];

const entitled = { features: ['focused_review'], plan: 'bolt', plans };
const got = await E.requireCapability({ entitlements: async () => entitled }, 'focused_review');
ok(got === entitled, 'an entitled user gets the entitlements back');

let err = await fails(E.requireCapability({ entitlements: async () => ({ features: [], plan: 'free', plans }) }, 'followup_practice'));
ok(err?.status === 403 && err.code === 'plan_required', 'a missing capability is a 403 plan_required');
ok(err.details.capability === 'followup_practice' && err.details.plan === 'bolt' && err.details.planName === 'Bolt' && err.details.current === 'free', 'the details name the cheapest plan that has it and the current plan');
ok(err.message === 'New practice questions are included with Bolt and Thunder. Nothing was used.', 'a plural capability reads "are included with A and B"');

err = await fails(E.requireCapability({ entitlements: async () => ({ features: [], plan: 'free', plans }) }, 'across_ask'));
ok(err.details.plan === 'thunder' && err.message === 'Asking across recordings is included with Thunder. Nothing was used.', 'a singular capability reads "is included with X"; plans without a tier are ignored');

err = await fails(E.requireCapability({ entitlements: async () => ({ features: [], plan: 'free', plans: [] }) }, 'across_guide'));
ok(err.details.plan === null && err.message.includes('a higher plan'), 'with no known plan offering it the message says "a higher plan"');

err = await fails(E.requireCapability({ entitlements: async () => ({ features: [], plan: 'free' }) }, 'focused_review'));
ok(err?.code === 'plan_required', 'missing plans list is treated as empty');

for (const [name, db] of [
  ['no entitlements function', {}],
  ['a null result', { entitlements: async () => null }],
  ['features that are not an array', { entitlements: async () => ({ features: 'all' }) }],
  ['a throwing lookup', { entitlements: async () => { throw new Error('db down'); } }],
]) {
  err = await fails(E.requireCapability(db, 'focused_review'));
  ok(err?.status === 503 && err.code === 'plan_unavailable', `${name}: refuses with 503 plan_unavailable (never treated as entitled)`);
}

err = await fails(E.requireCapability({ entitlements: async () => entitled }, 'teleport'));
ok(err instanceof Error && /unknown capability teleport/.test(err.message), 'an unknown capability is a programming error');

console.log(`${pass} checks passed`);
