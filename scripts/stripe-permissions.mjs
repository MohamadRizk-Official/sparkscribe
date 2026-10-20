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
//   * EXCESS permissions (what the runtime key must NOT be able to do): WRITE access to Products, Prices, Coupons and
//     Webhook Endpoints, i.e. changing the catalog or where events go. Checked with an always-invalid create (missing a
//     required field: no lookup, nothing can be created) and, where ids have a fixed prefix, an update of an id that
//     doesn't exist. Any 403 proves there is no write access (Stripe never answers 403 to a key that has it). A 400 on
//     the create with no 403 anywhere = the key can write (failure). Anything else = can't tell (failure, never a pass).
//     READ access is reported for information only: Stripe's permissions reference lists one *recommended* permission
//     per endpoint and says every endpoint is in "at least one" permission, so other permissions the runtime key needs
//     (Checkout Sessions, Subscriptions, Invoices, Customer portal: they all work with prices and products) can also
//     allow reading the catalog. Observed 2026-10-20: a live runtime key with Products = None got 200 on GET /v1/products
//     and 403 on POST /v1/products/<id>. Catalog read is not something the key can be configured out of, and it can't
//     change anything.

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

// What the runtime key must NOT be able to change (Stripe permission names from docs.stripe.com/keys/permissions-reference)
export const EXCESS = [
  { label: 'Products', permission: 'product_write', endpoint: 'POST /v1/products',
    writes: [{ endpoint: 'POST /v1/products (no name: always invalid)', create: true, call: (s) => s.products.create({ metadata: { sparkscribe_permission_probe: '1' } }) },
      { endpoint: `POST /v1/products/prod_${X}`, call: (s) => s.products.update(`prod_${X}`, { metadata: { p: '1' } }) }],
    read: { endpoint: 'GET /v1/products?limit=1', call: (s) => s.products.list({ limit: 1 }) } },
  { label: 'Prices', permission: 'plan_write', endpoint: 'POST /v1/prices',
    writes: [{ endpoint: 'POST /v1/prices (no currency: always invalid)', create: true, call: (s) => s.prices.create({ metadata: { sparkscribe_permission_probe: '1' } }) },
      { endpoint: `POST /v1/prices/price_${X}`, call: (s) => s.prices.update(`price_${X}`, { metadata: { p: '1' } }) }],
    read: { endpoint: 'GET /v1/prices?limit=1', call: (s) => s.prices.list({ limit: 1 }) } },
  // coupon ids are free-form: an update of a made-up id can answer "No such coupon" before the permission check
  { label: 'Coupons', permission: 'coupon_write', endpoint: 'POST /v1/coupons',
    writes: [{ endpoint: 'POST /v1/coupons (no amount: always invalid)', create: true, call: (s) => s.coupons.create({ duration: 'once', metadata: { sparkscribe_permission_probe: '1' } }) }],
    read: { endpoint: 'GET /v1/coupons?limit=1', call: (s) => s.coupons.list({ limit: 1 }) } },
  { label: 'Webhook Endpoints', permission: 'webhook_write', endpoint: 'POST /v1/webhook_endpoints',
    writes: [{ endpoint: 'POST /v1/webhook_endpoints (no url: always invalid)', create: true, call: (s) => s.webhookEndpoints.create({ enabled_events: ['invoice.paid'] }) },
      { endpoint: `POST /v1/webhook_endpoints/we_${X}`, call: (s) => s.webhookEndpoints.update(`we_${X}`, { metadata: { p: '1' } }) }],
    read: { endpoint: 'GET /v1/webhook_endpoints?limit=1', call: (s) => s.webhookEndpoints.list({ limit: 1 }) } },
];
// kept for compatibility (the labels the runtime key must not be able to change)
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

// EXCESS (write) from the answers to an entry's write probes -> 'none' | 'excess' | 'inconclusive'
//   [{ create, err }]: any 403 = no write ('none'), unless a create also got past the permission check (contradiction);
//   a create answered 400 (or succeeding, which an always-invalid create can't) with no 403 = 'excess'
export function classifyWrite(answers) {
  const denied = answers.some((a) => isPermissionError(a.err));
  const allowed = answers.some((a) => a.create && (!a.err || (!isPermissionError(a.err) && (a.err.statusCode === 400 || a.err.type === 'StripeInvalidRequestError'))));
  if (denied && !allowed) return 'none';
  if (allowed && !denied) return 'excess';
  return 'inconclusive';
}
// kept for the read report: a list read -> 'none' (403) | 'readable' | 'inconclusive'
export function classifyExcess(err) {
  if (!err) return 'readable';
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

// -> [{ label, permission, result: 'none' | 'excess' | 'inconclusive', writes: [{ endpoint, evidence }], read: { endpoint, evidence, result } }]
export async function checkExcess(stripe, list = EXCESS) {
  const out = [];
  for (const p of list) {
    const answers = [];
    for (const w of p.writes) {
      let err = null;
      try { await w.call(stripe); } catch (e) { err = e; }
      answers.push({ create: !!w.create, err, endpoint: w.endpoint, evidence: evidence(err), detail: err ? clean(err.message) : '' });
    }
    let rerr = null;
    try { await p.read.call(stripe); } catch (e) { rerr = e; }
    out.push({ label: p.label, permission: p.permission, result: classifyWrite(answers), writes: answers.map(({ endpoint, evidence: ev, detail }) => ({ endpoint, evidence: ev, detail })),
      read: { endpoint: p.read.endpoint, evidence: evidence(rerr), result: classifyExcess(rerr) } });
  }
  return out;
}

export const report = (rows) => rows.map((r) => `${r.result === 'ok' ? '✓' : '✗'} ${r.label}: ${r.level}  [${r.endpoint} → ${r.evidence}]${r.result === 'ok' ? '' : r.result === 'missing' ? `  — MISSING (needed to ${r.why})` : `  — could not check: ${r.detail}`}`).join('\n');
export const reportExcess = (rows) => rows.map((r) => {
  const head = r.result === 'none' ? `✓ ${r.label}: cannot change` : r.result === 'excess' ? `✗ ${r.label}: CAN CHANGE (the key has ${r.permission}; set ${r.label} to None)` : `✗ ${r.label}: can't tell whether it can change (answers below)`;
  const lines = r.writes.map((w) => `    [${w.endpoint} → ${w.evidence}]`);
  const read = `    · read: ${r.read.result === 'readable' ? 'readable (informational: catalog reads can come with other permissions the key needs; reading changes nothing)' : r.read.result === 'none' ? 'not readable' : 'unclear'}  [${r.read.endpoint} → ${r.read.evidence}]`;
  return [head, ...lines, read].join('\n');
}).join('\n');
