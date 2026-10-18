// Which Stripe permissions a key has, checked without changing anything: every write is tried against an id that
// doesn't exist (Stripe answers "No such …" when the key may write, 403 when it may not), every read with limit 1.
// Two roles (docs/launch/25-live-payments.md):
//   SETUP   — temporary key for scripts/stripe-setup.mjs + the Checkout probe (delete it afterwards)
//   RUNTIME — the Production server's key (server/billing/*, api/billing.js, api/stripe-webhook.js): only what it uses
// Permission labels are the resource names in Dashboard → Developers → API keys → Create restricted key.

const X = 'sparkscribepermprobe'; // never a real id

export const RUNTIME = [
  { label: 'Customers', level: 'Write', why: 'create the customer at first checkout; delete it with the account', probe: (s) => s.customers.update(`cus_${X}`, { metadata: { p: '1' } }) },
  { label: 'Checkout Sessions', level: 'Write', why: 'create Checkout; expire an older open one', probe: (s) => s.checkout.sessions.expire(`cs_live_${X}`) },
  { label: 'Subscriptions', level: 'Write', why: 'read the subscription in webhooks; cancel duplicates, orphans and deleted accounts', probe: (s) => s.subscriptions.cancel(`sub_${X}`) },
  { label: 'Customer portal', level: 'Write', why: 'open Manage Billing and the plan-change confirmation', probe: (s) => s.billingPortal.sessions.create({ customer: `cus_${X}` }) },
  { label: 'Refunds', level: 'Write', why: 'refund a duplicate subscription or a payment for a deleted account', probe: (s) => s.refunds.create({ charge: `ch_${X}` }) },
  { label: 'Invoices', level: 'Read', why: 'find what a duplicate/orphan subscription was charged', probe: (s) => s.invoices.retrieve(`in_${X}`) },
  { label: 'Invoice payments', level: 'Read', why: 'find the payment to refund on an invoice', probe: (s) => s.invoicePayments.list({ invoice: `in_${X}`, limit: 1 }) },
  { label: 'Subscription schedules', level: 'Read', why: 'show a downgrade scheduled for the next renewal', probe: (s) => s.subscriptionSchedules.retrieve(`sub_sched_${X}`) },
];

export const SETUP = [
  { label: 'Products', level: 'Write', why: 'create the SparkScribe Flash / Bolt / Thunder products', probe: (s) => s.products.update(`prod_${X}`, { metadata: { p: '1' } }) },
  { label: 'Prices', level: 'Write', why: 'create the monthly and yearly prices', probe: (s) => s.prices.update(`price_${X}`, { metadata: { p: '1' } }) },
  { label: 'Coupons', level: 'Write', why: 'create the Flash $1 first-month coupon', probe: (s) => s.coupons.update(`${X}`, { metadata: { p: '1' } }) },
  { label: 'Customer portal', level: 'Write', why: 'create the portal configuration (plans, cancellation, legal links)', probe: (s) => s.billingPortal.configurations.update(`bpc_${X}`, { metadata: { p: '1' } }) },
  { label: 'Webhook Endpoints', level: 'Write', why: 'create the signed webhook for www.spark-scribe.com', probe: (s) => s.webhookEndpoints.update(`we_${X}`, { metadata: { p: '1' } }) },
  { label: 'Checkout Sessions', level: 'Write', why: 'create and immediately expire one probe session per plan', probe: (s) => s.checkout.sessions.expire(`cs_live_${X}`) },
];

// Setup-level permissions the runtime key should NOT have (it never creates products, prices, coupons or webhooks)
export const NOT_FOR_RUNTIME = SETUP.filter((p) => !RUNTIME.some((r) => r.label === p.label));

// a Stripe error -> 'missing' (the key lacks the permission), 'ok' (allowed; the fake id just doesn't exist), 'error'
export function classify(err) {
  if (!err) return 'ok';
  const msg = String(err.message || '');
  if (err.statusCode === 403 || err.type === 'StripePermissionError' || /required permissions|does not have the required permission/i.test(msg)) return 'missing';
  if (err.code === 'resource_missing' || err.statusCode === 404 || /^No such /i.test(msg)) return 'ok';
  // a 400 about the fake id or its parameters still means the permission check passed
  if (err.statusCode === 400 || err.type === 'StripeInvalidRequestError') return 'ok';
  return 'error';
}

// -> [{ label, level, why, result: 'ok' | 'missing' | 'error', detail }]
export async function probe(stripe, list) {
  const out = [];
  for (const p of list) {
    let err = null;
    try { await p.probe(stripe); } catch (e) { err = e; }
    const result = classify(err);
    out.push({ label: p.label, level: p.level, why: p.why, result, detail: result === 'ok' ? '' : String(err?.message || '').replace(/(sk|rk)_(live|test)_[A-Za-z0-9]+/g, '<key>').slice(0, 200) });
  }
  return out;
}

export const report = (rows) => rows.map((r) => `${r.result === 'ok' ? '✓' : '✗'} ${r.label}: ${r.level}${r.result === 'ok' ? '' : r.result === 'missing' ? `  — MISSING (needed to ${r.why})` : `  — could not check: ${r.detail}`}`).join('\n');
