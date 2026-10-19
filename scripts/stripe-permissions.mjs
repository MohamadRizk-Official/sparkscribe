// Which Stripe permissions a key has, checked without changing anything in the account.
// Two roles (docs/launch/25-live-payments.md):
//   SETUP   — temporary key for scripts/stripe-setup.mjs + the Checkout probe (delete it afterwards)
//   RUNTIME — the Production server's key (server/billing/*, api/billing.js, api/stripe-webhook.js): only what it uses
// Permission labels are the resource names in Dashboard → Developers → API keys → Create restricted key.
//
// How each answer is read (tests/stripe-permissions-test.mjs):
//   * REQUIRED permissions: a write is tried against an id that doesn't exist, or as a create that is missing a required
//     field (so nothing can be created). 403 = the key lacks the permission; "No such …" (404) or a 400 about the
//     request = Stripe got past the permission check. 404 is only trusted on endpoints with a fixed id prefix; Coupons
//     (free-form ids) are probed with an invalid create instead, because there a lookup can answer before the check.
//   * EXCESS permissions (what the runtime key must NOT have): a list read (GET …?limit=1) with no object lookup, so the
//     answer is unambiguous: 403 = None (good); success = at least Read (too much); anything else = can't tell, which
//     counts as a failure, never a pass. A 404 can never be read as "has the permission" here.

const X = 'sparkscribepermprobe'; // never a real id

export const RUNTIME = [
  { label: 'Customers', level: 'Write', why: 'create the customer at first checkout; delete it with the account', endpoint: `POST /v1/customers/cus_${X}`, probe: (s) => s.customers.update(`cus_${X}`, { metadata: { p: '1' } }) },
  { label: 'Checkout Sessions', level: 'Write', why: 'create Checkout; expire an older open one', endpoint: `POST /v1/checkout/sessions/cs_live_${X}/expire`, probe: (s) => s.checkout.sessions.expire(`cs_live_${X}`) },
  { label: 'Subscriptions', level: 'Write', why: 'read the subscription in webhooks; cancel duplicates, orphans and deleted accounts', endpoint: `DELETE /v1/subscriptions/sub_${X}`, probe: (s) => s.subscriptions.cancel(`sub_${X}`) },
  { label: 'Customer portal', level: 'Write', why: 'open Manage Billing and the plan-change confirmation', endpoint: 'POST /v1/billing_portal/sessions', probe: (s) => s.billingPortal.sessions.create({ customer: `cus_${X}` }) },
  { label: 'Refunds', level: 'Write', why: 'refund a duplicate subscription or a payment for a deleted account', endpoint: 'POST /v1/refunds', probe: (s) => s.refunds.create({ charge: `ch_${X}` }) },
  { label: 'Invoices', level: 'Read', why: 'find what a duplicate/orphan subscription was charged', endpoint: 'GET /v1/invoices?limit=1', probe: (s) => s.invoices.list({ limit: 1 }) },
  { label: 'Invoice payments', level: 'Read', why: 'find the payment to refund on an invoice', endpoint: `GET /v1/invoice_payments?invoice=in_${X}`, probe: (s) => s.invoicePayments.list({ invoice: `in_${X}`, limit: 1 }) },
  { label: 'Subscription schedules', level: 'Read', why: 'show a downgrade scheduled for the next renewal', endpoint: 'GET /v1/subscription_schedules?limit=1', probe: (s) => s.subscriptionSchedules.list({ limit: 1 }) },
];

export const SETUP = [
  { label: 'Products', level: 'Write', why: 'create the SparkScribe Flash / Bolt / Thunder products', endpoint: `POST /v1/products/prod_${X}`, probe: (s) => s.products.update(`prod_${X}`, { metadata: { p: '1' } }) },
  { label: 'Prices', level: 'Write', why: 'create the monthly and yearly prices', endpoint: `POST /v1/prices/price_${X}`, probe: (s) => s.prices.update(`price_${X}`, { metadata: { p: '1' } }) },
  // a create without amount_off / percent_off is always refused (400), so no coupon can ever be made by this probe
  { label: 'Coupons', level: 'Write', why: 'create the Flash $1 first-month coupon', endpoint: 'POST /v1/coupons (no amount: always invalid)', probe: (s) => s.coupons.create({ duration: 'once', metadata: { sparkscribe_permission_probe: '1' } }) },
  { label: 'Customer portal', level: 'Write', why: 'create the portal configuration (plans, cancellation, legal links)', endpoint: `POST /v1/billing_portal/configurations/bpc_${X}`, probe: (s) => s.billingPortal.configurations.update(`bpc_${X}`, { metadata: { p: '1' } }) },
  { label: 'Webhook Endpoints', level: 'Write', why: 'create the signed webhook for www.spark-scribe.com', endpoint: `POST /v1/webhook_endpoints/we_${X}`, probe: (s) => s.webhookEndpoints.update(`we_${X}`, { metadata: { p: '1' } }) },
  { label: 'Checkout Sessions', level: 'Write', why: 'create and immediately expire one probe session per plan', endpoint: `POST /v1/checkout/sessions/cs_live_${X}/expire`, probe: (s) => s.checkout.sessions.expire(`cs_live_${X}`) },
];

// What the runtime key must NOT be able to touch at all (None, not even Read): it never creates or reads products,
// prices, coupons or webhook endpoints. Checked with list reads (see the header).
export const EXCESS = [
  { label: 'Products', endpoint: 'GET /v1/products?limit=1', probe: (s) => s.products.list({ limit: 1 }) },
  { label: 'Prices', endpoint: 'GET /v1/prices?limit=1', probe: (s) => s.prices.list({ limit: 1 }) },
  { label: 'Coupons', endpoint: 'GET /v1/coupons?limit=1', probe: (s) => s.coupons.list({ limit: 1 }) },
  { label: 'Webhook Endpoints', endpoint: 'GET /v1/webhook_endpoints?limit=1', probe: (s) => s.webhookEndpoints.list({ limit: 1 }) },
];
// kept for compatibility (the labels the runtime key must not have)
export const NOT_FOR_RUNTIME = EXCESS;

const isPermissionError = (err) => err && (err.statusCode === 403 || err.type === 'StripePermissionError' || /required permissions|does not have the required permission/i.test(String(err.message || '')));

// REQUIRED permission: a Stripe error -> 'missing' | 'ok' (allowed; the fake id doesn't exist / the request is invalid) | 'error'
export function classify(err) {
  if (!err) return 'ok';
  if (isPermissionError(err)) return 'missing';
  const msg = String(err.message || '');
  if (err.code === 'resource_missing' || err.statusCode === 404 || /^No such /i.test(msg)) return 'ok';
  // a 400 about the fake id or the deliberately incomplete request still means the permission check passed
  if (err.statusCode === 400 || err.type === 'StripeInvalidRequestError') return 'ok';
  return 'error';
}

// EXCESS permission (list read): -> 'none' (403: the key can't touch it) | 'excess' (the read succeeded) | 'inconclusive'
export function classifyExcess(err) {
  if (!err) return 'excess';
  if (isPermissionError(err)) return 'none';
  return 'inconclusive';
}

const evidence = (err) => (err ? `HTTP ${err.statusCode ?? '?'}${err.code ? ` ${err.code}` : ''}${err.type ? ` (${err.type})` : ''}` : 'HTTP 200');
const clean = (s) => String(s || '').replace(/(sk|rk)_(live|test)_[A-Za-z0-9]+/g, '<key>').slice(0, 200);

// -> [{ label, level, why, endpoint, result: 'ok' | 'missing' | 'error', evidence, detail }]
export async function probe(stripe, list) {
  const out = [];
  for (const p of list) {
    let err = null;
    try { await p.probe(stripe); } catch (e) { err = e; }
    const result = classify(err);
    out.push({ label: p.label, level: p.level, why: p.why, endpoint: p.endpoint, result, evidence: evidence(err), detail: result === 'ok' ? '' : clean(err?.message) });
  }
  return out;
}

// -> [{ label, endpoint, result: 'none' | 'excess' | 'inconclusive', evidence, detail }]
export async function checkExcess(stripe, list = EXCESS) {
  const out = [];
  for (const p of list) {
    let err = null;
    try { await p.probe(stripe); } catch (e) { err = e; }
    out.push({ label: p.label, endpoint: p.endpoint, result: classifyExcess(err), evidence: evidence(err), detail: err ? clean(err.message) : '' });
  }
  return out;
}

export const report = (rows) => rows.map((r) => `${r.result === 'ok' ? '✓' : '✗'} ${r.label}: ${r.level}  [${r.endpoint} → ${r.evidence}]${r.result === 'ok' ? '' : r.result === 'missing' ? `  — MISSING (needed to ${r.why})` : `  — could not check: ${r.detail}`}`).join('\n');
export const reportExcess = (rows) => rows.map((r) => `${r.result === 'none' ? '✓' : '✗'} ${r.label}: ${r.result === 'none' ? 'None' : r.result === 'excess' ? 'HAS ACCESS (set it to None)' : `can't tell: ${r.detail}`}  [${r.endpoint} → ${r.evidence}]`).join('\n');
