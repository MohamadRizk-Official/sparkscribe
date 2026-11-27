// Billing service guards (server/billing/service.js): getStatus, createCheckout, createPortal and scheduledChange
// refuse or return early BEFORE any Stripe call. Stripe is never reached: every case here stops earlier, and the
// database is a small stand-in. Environment variables are set per case and restored at the end.
import assert from 'node:assert/strict';
const saved = { ...process.env };
const reset = () => { for (const k of Object.keys(process.env)) if (/^(STRIPE_|BILLING_)/.test(k)) delete process.env[k]; };
reset();
const S = await import(new URL('../server/billing/service.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const fail = async (p) => { try { await p; } catch (e) { return e; } return null; };
const rpc = (data, error = null) => ({ rpc: async (name) => { rpc.last = name; return { data, error }; } });
const table = (row) => ({ from: (t) => { table.last = t; const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: row }) }; return q; } });

// ---- getStatus
const status = { plan: 'free', usedSeconds: 5 };
ok((await S.getStatus(rpc(status))) === status && rpc.last === 'billing_status', 'getStatus returns what billing_status() reports');
for (const [label, sb] of [['an error', rpc(null, { message: 'boom' })], ['no data', rpc(null)]]) {
  const e = await fail(S.getStatus(sb));
  ok(e?.status === 503 && e.code === 'status_unavailable', `${label} from the database is a 503 status_unavailable`);
}
ok(!/boom/.test((await fail(S.getStatus(rpc(null, { message: 'boom' }))))?.message), 'the database\'s own message is not shown to the user');

// ---- createCheckout: refused before Stripe or the database
const user = { id: 'u1', email: 'a@example.com' };
let e = await fail(S.createCheckout(null, user, 'flash', 'https://x.test'));
ok(e?.status === 503 && e.code === 'payments_unavailable', 'with no Stripe key, checkout is refused as payments_unavailable');
process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
e = await fail(S.createCheckout(null, user, 'flash', 'https://x.test'));
ok(e?.code === 'payments_unavailable', 'a test key alone is not enough: BILLING_PAYMENTS_ENABLED=1 is needed too');
process.env.BILLING_PAYMENTS_ENABLED = '1';
process.env.BILLING_CHECKOUT_ALLOWLIST = 'friend@example.com';
e = await fail(S.createCheckout(null, user, 'flash', 'https://x.test'));
ok(e?.status === 503 && e.code === 'payments_unavailable' && /aren't available yet/.test(e.message), 'during the pilot an account not on the allowlist is refused');
delete process.env.BILLING_CHECKOUT_ALLOWLIST;
for (const bad of ['week', '', 'YEAR']) {
  e = await fail(S.createCheckout(null, user, 'flash', 'https://x.test', bad));
  ok(e?.status === 400 && e.code === 'bad_interval', `billing interval ${JSON.stringify(bad)} is refused as bad_interval`);
}
process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
e = await fail(S.createCheckout(null, user, 'flash', 'https://x.test'));
ok(e?.code === 'payments_unavailable', 'a live key needs BILLING_LIVE_APPROVED=1 as well');
reset();

// ---- createPortal
e = await fail(S.createPortal(table(null), user, 'https://x.test'));
ok(e?.status === 503 && e.code === 'payments_unavailable', 'the portal is closed while billing is not configured');
process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
e = await fail(S.createPortal(table(null), user, 'https://x.test'));
ok(e?.status === 404 && e.code === 'no_billing_account' && table.last === 'subscriptions', 'a user with no billing row has nothing to manage (404)');
e = await fail(S.createPortal(table({ stripe_customer_id: null, livemode: false }), user, 'https://x.test'));
ok(e?.code === 'no_billing_account', 'a row with no Stripe customer is the same 404');
e = await fail(S.createPortal(table({ stripe_customer_id: 'cus_1', livemode: true }), user, 'https://x.test'));
ok(e?.code === 'no_billing_account', 'a customer from the other mode (live vs test) is not served');
process.env.STRIPE_SECRET_KEY = 'sk_live_abc';
e = await fail(S.createPortal(table({ stripe_customer_id: 'cus_1', livemode: true }), user, 'https://x.test'));
ok(e?.code === 'payments_unavailable', 'with a live key the portal still needs BILLING_LIVE_APPROVED=1');
reset();

// ---- scheduledChange
table.last = null;
ok((await S.scheduledChange(table({ stripe_subscription_id: 'sub_1', livemode: false }), user)) === null && table.last === null, 'with billing off there is no scheduled change and the database is not asked');
process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
ok((await S.scheduledChange(table(null), user)) === null, 'a user with no subscription row has none');
ok((await S.scheduledChange(table({ stripe_subscription_id: null, livemode: false }), user)) === null, 'a row without a subscription id has none');
ok((await S.scheduledChange(table({ stripe_subscription_id: 'sub_1', livemode: true }), user)) === null, 'a subscription from the other mode is ignored');

for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
Object.assign(process.env, saved);
console.log(`\n${pass} checks passed`);
