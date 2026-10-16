// Premium capabilities (Bolt, Thunder). The server decides, from the plan the database computes for the signed-in user
// (billing_status: the subscription as Stripe reported it). Nothing the browser sends about its plan is read. Checked
// before any recording is loaded or any AI call is made, so a refused request costs nothing and uses no allowance.
import { AIError } from './ai/provider.js';

export const CAPABILITIES = Object.freeze({
  focused_review: { label: 'Focused Review', plural: false },
  followup_practice: { label: 'New practice questions', plural: true },
  across_ask: { label: 'Asking across recordings', plural: false },
  across_guide: { label: 'Combined study guides', plural: true },
});

export async function requireCapability(db, capability) {
  if (!CAPABILITIES[capability]) throw new Error(`unknown capability ${capability}`);
  let e = null;
  try { e = typeof db.entitlements === 'function' ? await db.entitlements() : null; } catch { e = null; }
  // the plan can't be determined: refuse (never treat as entitled)
  if (!e || !Array.isArray(e.features)) throw new AIError("Your plan couldn't be checked right now. Nothing was used. Try again in a moment.", { status: 503, code: 'plan_unavailable' });
  if (e.features.includes(capability)) return e;
  const having = (e.plans || []).filter((p) => p.tier != null && (p.features || []).includes(capability)).sort((a, b) => a.tier - b.tier);
  const need = having[0] || null;
  const { label, plural } = CAPABILITIES[capability];
  const where = having.length ? having.map((p) => p.name).join(' and ') : 'a higher plan';
  throw Object.assign(new AIError(`${label} ${plural ? 'are' : 'is'} included with ${where}. Nothing was used.`, { status: 403, code: 'plan_required' }),
    { details: { capability, plan: need?.key || null, planName: need?.name || null, current: e.plan } });
}
