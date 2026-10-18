// Billing server code (api/stripe-webhook.js, server/billing/*) against: an isolated Postgres (PGlite, every
// production migration) behind a minimal PostgREST stand-in, and a fake Stripe API on 127.0.0.1. Webhook signatures
// are made and checked with the real Stripe library. No network, no Stripe account, no money.
//   node qa/sql/billing-server.test.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import Stripe from 'stripe';
import { freshDb } from './pg.mjs';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const ROOT = new URL('../../', import.meta.url).href;

// ---------- isolated database ----------
const P = await freshDb({ proposed: true });
const { db } = P;
const SECRET = 'qa-billing-secret';
await db.query(`insert into private.billing_secrets (name, hash) values ('server', sha256(convert_to($1, 'UTF8')))`, [SECRET]);
const user = await P.createUser('payer@example.com');
const other = await P.createUser('other@example.com');
const statusOf = (uid) => P.asUser(uid, async (d) => (await d.query('select public.billing_status() r')).rows[0].r);

// ---------- PostgREST stand-in: the two request shapes the billing server uses ----------
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const rest = http.createServer(async (req, res) => {
  const body = await new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
  const url = new URL(req.url, 'http://x');
  const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    const rpc = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
    if (rpc && req.method === 'POST') {
      const args = JSON.parse(body || '{}');
      const keys = Object.keys(args);
      const r = await P.asAnon((d) => d.query(`select public.${rpc[1]}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) r`, keys.map((k) => args[k])));
      return send(200, r.rows[0].r);
    }
    if (url.pathname === '/rest/v1/billing_plans' && req.method === 'GET') {
      const r = await P.asAnon((d) => d.query(`select key, name, tagline, price_cents, yearly_price_cents, currency, billing_interval, monthly_seconds, tier, features, intro_price_cents, intro_months, is_default from public.billing_plans where tier is not null order by tier`));
      return send(200, r.rows);
    }
    send(404, { code: 'PGRST125', message: 'not in the stand-in' });
  } catch (e) { send(400, { code: e.code || 'P0001', message: e.message }); }
});
const restPort = await listen(rest);

// ---------- fake Stripe API ----------
const stripeCalls = [];
const subs = new Map();
let nextId = 1;
const openSessions = new Map();      // checkout session id -> customer
let lastCheckout = null;             // the form of the last Checkout session created
const invoices = new Map();          // invoice id -> { id, subscription, amount_paid, status, pi }
const refunds = [];
const deletedCustomers = [];
const list = (data) => ({ object: 'list', data, has_more: false });
const fake = http.createServer(async (req, res) => {
  const body = await new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
  stripeCalls.push(`${req.method} ${req.url.split('?')[0]}`);
  const send = (obj, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const [path, qs = ''] = req.url.split('?');
  const q = new URLSearchParams(qs);
  const form = new URLSearchParams(body);
  if (path === '/v1/customers' && req.method === 'POST') return send({ id: `cus_${nextId++}`, object: 'customer' });
  const cus = /^\/v1\/customers\/(cus_[A-Za-z0-9_]+)$/.exec(path);
  if (cus && req.method === 'DELETE') { deletedCustomers.push(cus[1]); return send({ id: cus[1], object: 'customer', deleted: true }); }
  if (path === '/v1/subscriptions' && req.method === 'GET') return send(list([...subs.values()].filter((x) => !q.get('customer') || x.customer === q.get('customer'))));
  if (path === '/v1/checkout/sessions' && req.method === 'GET') return send(list([...openSessions].filter(([, c]) => c === q.get('customer')).map(([id]) => ({ id, object: 'checkout.session', status: 'open' }))));
  if (path === '/v1/checkout/sessions' && req.method === 'POST') {
    const id = `cs_test_${nextId++}`;
    openSessions.set(id, form.get('customer'));
    lastCheckout = form;
    return send({ id, object: 'checkout.session', url: `https://checkout.stripe.test/${id}`, body });
  }
  const exp = /^\/v1\/checkout\/sessions\/(cs_[a-z0-9_]+)\/expire$/.exec(path);
  if (exp) { openSessions.delete(exp[1]); return send({ id: exp[1], object: 'checkout.session', status: 'expired' }); }
  if (path === '/v1/invoices' && req.method === 'GET') return send(list([...invoices.values()].filter((i) => i.subscription === q.get('subscription') && (!q.get('status') || i.status === q.get('status')))));
  const inv = /^\/v1\/invoices\/(in_[a-z0-9_]+)$/.exec(path);
  if (inv && invoices.has(inv[1])) return send(invoices.get(inv[1]));
  if (path === '/v1/invoice_payments' && req.method === 'GET') {
    const i = invoices.get(q.get('invoice'));
    return send(list(i ? [{ id: `inpay_${i.id}`, object: 'invoice_payment', status: 'paid', payment: { type: 'payment_intent', payment_intent: i.pi } }] : []));
  }
  if (path === '/v1/refunds' && req.method === 'POST') { refunds.push({ pi: form.get('payment_intent'), reason: form.get('reason'), key: req.headers['idempotency-key'] }); return send({ id: `re_${nextId++}`, object: 'refund' }); }
  const m = /^\/v1\/subscriptions\/(sub_[a-z0-9_]+)$/.exec(path);
  if (m && subs.has(m[1]) && req.method === 'DELETE') { const x = { ...subs.get(m[1]), status: 'canceled', canceled_at: Math.floor(Date.now() / 1000) }; subs.set(m[1], x); return send(x); }
  if (m && subs.has(m[1])) return send(subs.get(m[1]));
  send({ error: { type: 'invalid_request_error', message: 'No such resource' } }, 404);
});
const stripePort = await listen(fake);

Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${restPort}`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_qa',
  BILLING_DB_SECRET: SECRET, STRIPE_WEBHOOK_SECRET: 'whsec_qa_test', STRIPE_API_HOST: `127.0.0.1:${stripePort}`,
  STRIPE_FLASH_PRICE_ID: 'price_flash', STRIPE_BOLT_PRICE_ID: 'price_bolt', STRIPE_THUNDER_PRICE_ID: 'price_thunder',
  STRIPE_FLASH_YEARLY_PRICE_ID: 'price_flashyear', STRIPE_BOLT_YEARLY_PRICE_ID: 'price_boltyear', STRIPE_THUNDER_YEARLY_PRICE_ID: 'price_thunderyear',
  STRIPE_FLASH_INTRO_COUPON: 'sparkscribe_flash_intro_499',
});
delete process.env.VERCEL;
const quiet = console.log; console.log = (...a) => { if (!String(a[0]).startsWith('[billing]')) quiet(...a); };
const config = await import(ROOT + 'server/billing/config.js');
const service = await import(ROOT + 'server/billing/service.js');
const webhook = (await import(ROOT + 'api/stripe-webhook.js')).default;

// ---------- 1. payments are off unless deliberately switched on ----------
const env = (o) => ({ STRIPE_SECRET_KEY: '', BILLING_PAYMENTS_ENABLED: '', BILLING_LIVE_APPROVED: '', ...o });
ok(!config.paymentsEnabled(env({})), 'no Stripe key → payments off');
ok(!config.paymentsEnabled(env({ STRIPE_SECRET_KEY: 'sk_test_x' })), 'test key alone → payments off (needs BILLING_PAYMENTS_ENABLED=1)');
ok(config.paymentsEnabled(env({ STRIPE_SECRET_KEY: 'sk_test_x', BILLING_PAYMENTS_ENABLED: '1' })), 'test key + switch → test payments on');
ok(!config.paymentsEnabled(env({ STRIPE_SECRET_KEY: 'sk_live_x', BILLING_PAYMENTS_ENABLED: '1' })), 'LIVE key + switch but no approval → payments off');
ok(config.paymentsEnabled(env({ STRIPE_SECRET_KEY: 'sk_live_x', BILLING_PAYMENTS_ENABLED: '1', BILLING_LIVE_APPROVED: '1' })), 'LIVE key + switch + approval → on (the only way to take real money)');
ok(!config.paymentsEnabled(env({ STRIPE_SECRET_KEY: 'pk_live_x', BILLING_PAYMENTS_ENABLED: '1', BILLING_LIVE_APPROVED: '1' })), 'a publishable key is never accepted as a secret key');

// the signed-in user's Supabase client, as the billing server uses it: their subscription row and billing_status()
const fakeSb = (uid) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: (await db.query('select stripe_customer_id, livemode from public.subscriptions where user_id = $1', [uid])).rows[0] || null }) }) }) }),
  rpc: async (fn) => (fn === 'billing_status' ? { data: await statusOf(uid), error: null } : { data: null, error: { code: 'PGRST202' } }),
});
const tryCheckoutFor = async (uid, plan, interval) => { try { return await service.createCheckout(fakeSb(uid), { id: uid, email: `${uid.slice(0, 6)}@example.com` }, plan, 'http://localhost:5173', interval); } catch (e) { return e; } };
const tryCheckout = async (plan = 'flash') => tryCheckoutFor(user, plan);
for (const [label, vars] of [['no key', {}], ['test key without the switch', { STRIPE_SECRET_KEY: 'sk_test_qa' }], ['live key without approval', { STRIPE_SECRET_KEY: 'sk_live_qa', BILLING_PAYMENTS_ENABLED: '1' }]]) {
  Object.assign(process.env, env(vars));
  const before = stripeCalls.length;
  const e = await tryCheckout();
  ok(e.code === 'payments_unavailable' && e.status === 503 && /Nothing was charged/.test(e.message) && stripeCalls.length === before, `checkout refused (${label}): 503 before any Stripe call`);
}
const authorized = await service.authorize({ rpc: async () => ({ data: await statusOf(user), error: null }) }, 600);
ok(authorized.ok && authorized.upgradesAvailable === false, 'authorize: recordings allowed, upgrade buttons not offered while payments are off');

// ---------- 2. test mode on: checkout happens entirely against the fake Stripe ----------
Object.assign(process.env, env({ STRIPE_SECRET_KEY: 'sk_test_qa', BILLING_PAYMENTS_ENABLED: '1' }));
const c = await tryCheckout('flash');
ok(/^https:\/\/checkout\.stripe\.test\/cs_test_\d+$/.test(c.url) && stripeCalls.includes('POST /v1/customers') && stripeCalls.includes('POST /v1/checkout/sessions'), 'test mode + switch: Checkout session created (fake Stripe)');
ok((await statusOf(user)).introEligible === true, 'a new account is eligible for the $1 first month (decided by the database)');
ok(lastCheckout.get('discounts[0][coupon]') === 'sparkscribe_flash_intro_499' && lastCheckout.get('metadata[intro]') === '1' && !lastCheckout.has('allow_promotion_codes'),
  'eligible + Flash: Checkout carries the server’s introductory coupon (no customer-entered codes)');
ok(lastCheckout.get('subscription_data[metadata][sparkscribe_scope]') === 'app' && lastCheckout.get('line_items[0][price]') === 'price_flash', 'the subscription is tagged with this deployment’s scope; the price is the server’s Flash price');
const cb = await tryCheckout('bolt');
ok(cb.url && !lastCheckout.has('discounts[0][coupon]') && lastCheckout.get('allow_promotion_codes') === 'false' && lastCheckout.get('metadata[intro]') === '0', 'Bolt: no introductory price, and no promotion codes');
delete process.env.STRIPE_FLASH_INTRO_COUPON;
const noCoupon = await tryCheckout('flash');
ok(noCoupon.code === 'intro_unavailable' && noCoupon.status === 503, 'eligible but the coupon isn’t configured: refused (never charges $5.99 when the page said $1)');
process.env.STRIPE_FLASH_INTRO_COUPON = 'sparkscribe_flash_intro_499';
const c2 = await tryCheckout('flash');
ok(c2.url !== c.url && openSessions.size === 1 && !openSessions.has(c.url.split('/').pop()), 'a second Checkout (another tab, double click) closes the first one: only one can be paid');
const linked = (await db.query('select stripe_customer_id, livemode from public.subscriptions where user_id = $1', [user])).rows[0];
ok(linked?.stripe_customer_id?.startsWith('cus_') && linked.livemode === false, 'the Stripe customer is linked to this account (test mode)');
ok(!lastCheckout.has('automatic_tax[enabled]') && !lastCheckout.has('billing_address_collection'), 'Stripe Tax off by default: Checkout adds no tax and asks for no address');
process.env.STRIPE_AUTOMATIC_TAX = '1';
const taxed = await tryCheckout('flash');
ok(taxed.url && lastCheckout.get('automatic_tax[enabled]') === 'true' && lastCheckout.get('billing_address_collection') === 'required' && lastCheckout.get('customer_update[address]') === 'auto', 'STRIPE_AUTOMATIC_TAX=1: Checkout collects the billing address and adds the tax Stripe calculates');
delete process.env.STRIPE_AUTOMATIC_TAX;
const bad = await tryCheckout('enterprise');
ok(bad.code === 'bad_plan', 'only known paid plan keys are accepted');

// ---------- 3. webhooks ----------
const signer = new Stripe('sk_test_qa');
const deliver = async (event, opts = {}) => {
  const { secret = 'whsec_qa_test', method = 'POST', timestamp } = opts;
  const payload = JSON.stringify(event);
  const header = 'sig' in opts ? opts.sig : signer.webhooks.generateTestHeaderString({ payload, secret, ...(timestamp && { timestamp }) });
  const req = Readable.from([Buffer.from(payload)]);
  req.method = method; req.headers = header === null ? {} : { 'stripe-signature': header };
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); } };
  await webhook(req, res);
  return res;
};
const now = Math.floor(Date.now() / 1000);
const customer = linked.stripe_customer_id;
const subscription = (o = {}) => ({ id: 'sub_qa_1', object: 'subscription', customer, status: 'active', livemode: false, metadata: { supabase_user_id: user }, cancel_at_period_end: false, cancel_at: null, canceled_at: null, items: { data: [{ id: 'si_1', price: { id: 'price_flash' }, current_period_start: now, current_period_end: now + 30 * 86400 }] }, ...o });
const event = (id, type, object, o = {}) => ({ id, object: 'event', type, livemode: false, data: { object }, ...o });

ok((await deliver(event('evt_a', 'customer.subscription.updated', { id: 'sub_qa_1' }), { method: 'GET' })).statusCode === 405, 'webhook: only POST');
ok((await deliver(event('evt_a', 'customer.subscription.updated', { id: 'sub_qa_1' }), { sig: null })).statusCode === 400, 'webhook: missing signature → 400');
ok((await deliver(event('evt_a', 'customer.subscription.updated', { id: 'sub_qa_1' }), { secret: 'whsec_attacker' })).statusCode === 400, 'webhook: signed with the wrong secret → 400');
ok((await deliver(event('evt_a', 'customer.subscription.updated', { id: 'sub_qa_1' }), { timestamp: now - 3600 })).statusCode === 400, 'webhook: replayed old delivery (1 h) → 400');
ok((await statusOf(user)).plan === 'free', '…and none of those changed anything');

subs.set('sub_qa_1', subscription());
const r1 = await deliver(event('evt_checkout', 'checkout.session.completed', { id: 'cs_test_1', mode: 'subscription', subscription: 'sub_qa_1', customer, client_reference_id: user, metadata: { supabase_user_id: user, plan: 'flash', intro: '1' }, total_details: { amount_discount: 499 }, payment_status: 'paid' }));
ok(r1.statusCode === 200 && (await statusOf(user)).plan === 'flash', 'checkout.session.completed (valid signature) → Flash, from Stripe’s own subscription record');
const promo = (await db.query(`select promo, checkout_session from private.billing_promotions where user_id = $1`, [user])).rows;
ok(promo.length === 1 && promo[0].promo === 'flash_intro' && promo[0].checkout_session === 'cs_test_1' && (await statusOf(user)).introEligible === false, 'the $1 offer is recorded as used when that Checkout completes; the account is no longer eligible');
ok((await db.query(`select first_plan from private.billing_paid_history where user_id = $1`, [user])).rows[0]?.first_plan === 'flash', 'the first paid plan is recorded (a returning customer is never eligible again)');
const dup = await deliver(event('evt_checkout', 'checkout.session.completed', { id: 'cs_test_1', mode: 'subscription', subscription: 'sub_qa_1', customer, client_reference_id: user }));
ok(dup.statusCode === 200 && dup.body.duplicate === true, 'the same event again → acknowledged as duplicate, not re-applied');

subs.set('sub_qa_1', subscription({ items: { data: [{ id: 'si_1', price: { id: 'price_bolt' }, current_period_start: now, current_period_end: now + 30 * 86400 }] } }));
await deliver(event('evt_up', 'customer.subscription.updated', { id: 'sub_qa_1' }));
ok((await statusOf(user)).plan === 'bolt', 'upgrade (subscription.updated) → Bolt');
subs.set('sub_qa_1', subscription({ status: 'past_due' }));
const pf = await deliver(event('evt_fail', 'invoice.payment_failed', { id: 'in_1', subscription: 'sub_qa_1', customer }));
const sp = await statusOf(user);
ok(pf.statusCode === 200 && sp.plan === 'flash' && sp.paymentProblem, 'invoice.payment_failed → access kept while Stripe retries, problem shown');
subs.set('sub_qa_1', subscription({ cancel_at_period_end: true }));
await deliver(event('evt_cancel', 'customer.subscription.updated', { id: 'sub_qa_1' }));
ok((await statusOf(user)).cancelAtPeriodEnd === true, 'cancellation at period end is reflected');
subs.set('sub_qa_1', subscription({ status: 'canceled', canceled_at: now }));
await deliver(event('evt_end', 'customer.subscription.deleted', { id: 'sub_qa_1' }));
ok((await statusOf(user)).plan === 'free', 'subscription.deleted → Free');

const live = await deliver(event('evt_live', 'customer.subscription.updated', { id: 'sub_qa_1' }, { livemode: true }));
ok(live.statusCode === 200 && live.body.ignored === 'other_mode', 'a live-mode event reaching the test setup is ignored');
subs.set('sub_foreign', subscription({ id: 'sub_foreign', customer: 'cus_unknown', metadata: {} }));
const foreign = await deliver(event('evt_foreign', 'customer.subscription.updated', { id: 'sub_foreign' }));
ok(foreign.statusCode === 200 && foreign.body.refused === 'unknown_customer', 'a subscription for an unknown customer → 200 refused (final; no retry storm)');
subs.set('sub_steal', subscription({ id: 'sub_steal', metadata: { supabase_user_id: other } }));
const steal = await deliver(event('evt_steal', 'customer.subscription.updated', { id: 'sub_steal' }));
ok(steal.body.refused === 'user_mismatch' && (await statusOf(other)).plan === 'free', 'a subscription claiming another user is refused');
// another deployment's object (a different Preview or a local QA run sharing this sandbox) is never touched
subs.set('sub_scoped', subscription({ id: 'sub_scoped', metadata: { supabase_user_id: user, sparkscribe_scope: 'qa-local' } }));
const scoped = await deliver(event('evt_scoped', 'customer.subscription.updated', { id: 'sub_scoped', metadata: { supabase_user_id: user, sparkscribe_scope: 'qa-local' } }));
ok(scoped.statusCode === 200 && scoped.body.ignored === 'other_scope', 'an event about another deployment’s subscription is ignored (no orphan cancellation, no state change)');
// a price this server doesn't know: grants nothing, and raises an operator alert (ids only)
const errs = []; const err0 = console.error; console.error = (...a) => errs.push(a.join(' '));
subs.set('sub_unknown_price', subscription({ id: 'sub_unknown_price', items: { data: [{ id: 'si_u', price: { id: 'price_mystery' }, current_period_start: now, current_period_end: now + 30 * 86400 }] } }));
const subsBefore = new Map(subs);
for (const [k, v] of subsBefore) if (k !== 'sub_unknown_price' && ['active', 'trialing', 'past_due'].includes(v.status)) subs.set(k, { ...v, status: 'canceled' });
await deliver(event('evt_unknown_price', 'customer.subscription.updated', { id: 'sub_unknown_price' }));
console.error = err0;
ok((await statusOf(user)).plan === 'free' && errs.some((e) => /"unknown_price".*"alert":true.*price_mystery/.test(e)) && !errs.some((e) => /payer@|sk_|whsec_/.test(e)), 'unknown price → Free, plus an operator alert with ids only');
for (const [k, v] of subsBefore) subs.set(k, v);
subs.delete('sub_unknown_price');
const logged = (await db.query(`select id, result from public.billing_events order by created_at`)).rows.map((r) => `${r.id}:${r.result}`);
ok(logged.includes('evt_checkout:synced') && logged.includes('evt_foreign:refused:unknown_customer'), `every processed event is logged with its outcome (${logged.length} events)`);

// ---------- 3b. the introductory offer: who gets it ----------
const returning = await P.createUser('returning@example.com');
await db.query(`insert into private.billing_paid_history (user_id, livemode, first_plan) values ($1, false, 'flash')`, [returning]);
const ret = await tryCheckoutFor(returning, 'flash');
ok(ret.url && !lastCheckout.has('discounts[0][coupon]') && (await statusOf(returning)).introEligible === false, 'a returning customer (had Flash before) gets the regular $5.99, and the page is told so (introEligible: false)');
// ---------- 3a. pilot: only allow-listed accounts can start a checkout ----------
{
  const pilot = await P.createUser('pilot@example.com'), other2 = await P.createUser('someone@example.com');
  process.env.BILLING_CHECKOUT_ALLOWLIST = ' Pilot@Example.com ';
  const before = stripeCalls.length;
  const no = await service.createCheckout(fakeSb(other2), { id: other2, email: 'someone@example.com' }, 'flash', 'http://localhost:5173').catch((e) => e);
  ok(no.code === 'payments_unavailable' && /Nothing was charged/.test(no.message) && stripeCalls.length === before, 'pilot: an account not on the list is refused before any Stripe call');
  const yes = await service.createCheckout(fakeSb(pilot), { id: pilot, email: 'pilot@example.com' }, 'flash', 'http://localhost:5173');
  ok(yes.url && lastCheckout.get('line_items[0][price]') === 'price_flash', 'pilot: the listed account (email, any case) gets Checkout');
  const st = { rpc: async () => ({ data: await statusOf(other2), error: null }) };
  ok((await service.authorize(st, 600, { id: other2, email: 'someone@example.com' })).upgradesAvailable === false && (await service.authorize(st, 600, null)).upgradesAvailable === false, 'pilot: others are not offered upgrades');
  ok(config.checkoutAllowedFor({ id: pilot, email: 'x@y.z' }, { BILLING_CHECKOUT_ALLOWLIST: pilot.toUpperCase() }) && config.checkoutAllowedFor({ id: 'a', email: 'b' }, {}), 'the list also accepts account ids; no list = everyone');
  delete process.env.BILLING_CHECKOUT_ALLOWLIST;
}

// ---------- 3c. yearly billing ----------
{
  const yu = await P.createUser('yearly@example.com');
  ok((await statusOf(yu)).introEligible === true, 'yearly: a new account (eligible for the monthly $1 offer)');
  const before = stripeCalls.length;
  const badI = await tryCheckoutFor(yu, 'flash', 'week');
  ok(badI.code === 'bad_interval' && badI.status === 400 && stripeCalls.length === before, 'an unknown billing interval is refused before any Stripe call');
  const yc = await tryCheckoutFor(yu, 'flash', 'year');
  ok(yc.url && lastCheckout.get('line_items[0][price]') === 'price_flashyear' && lastCheckout.get('metadata[interval]') === 'year' && lastCheckout.get('subscription_data[metadata][interval]') === 'year',
    'yearly Flash: Checkout uses the server’s yearly Flash price');
  ok(!lastCheckout.has('discounts[0][coupon]') && lastCheckout.get('allow_promotion_codes') === 'false' && lastCheckout.get('metadata[intro]') === '0',
    'yearly Flash never gets the $1 first-month coupon, even for an eligible account');
  ok(/^\$59 today, then \$59 every year until you cancel\. 3 hours of transcription renew every month\./.test(lastCheckout.get('custom_text[submit][message]')) && !lastCheckout.has('consent_collection[terms_of_service]'),
    'yearly Checkout states the renewal terms next to the pay button');
  const mc = await tryCheckoutFor(yu, 'flash', 'month');
  ok(mc.url && lastCheckout.get('line_items[0][price]') === 'price_flash' && lastCheckout.get('discounts[0][coupon]') === 'sparkscribe_flash_intro_499', '…while monthly Flash for the same account still gets it');
  ok(/^\$1 today for your first month, then \$5\.99 every month until you cancel\./.test(lastCheckout.get('custom_text[submit][message]')), 'the $1 month and the renewal price are both stated at checkout');
  process.env.STRIPE_REQUIRE_TOS = '1';
  await tryCheckoutFor(yu, 'thunder', 'month');
  ok(lastCheckout.get('consent_collection[terms_of_service]') === 'required' && /^\$14\.99 today, then \$14\.99 every month/.test(lastCheckout.get('custom_text[submit][message]')), 'STRIPE_REQUIRE_TOS=1: the customer must accept the Terms in Checkout');
  delete process.env.STRIPE_REQUIRE_TOS;
  const dc = await tryCheckoutFor(yu, 'bolt');
  ok(dc.url && lastCheckout.get('line_items[0][price]') === 'price_bolt', 'no interval given: monthly (older pages keep working)');
  const savedY = process.env.STRIPE_THUNDER_YEARLY_PRICE_ID;
  delete process.env.STRIPE_THUNDER_YEARLY_PRICE_ID;
  const ny = await tryCheckoutFor(yu, 'thunder', 'year');
  ok(ny.code === 'billing_not_configured' && /Yearly billing isn’t available/.test(ny.message) && /Nothing was charged/.test(ny.message), 'yearly price not configured → refused, nothing charged');
  process.env.STRIPE_THUNDER_YEARLY_PRICE_ID = savedY;
  await db.query(`update public.billing_plans set yearly_price_cents = null where key = 'bolt'`); config.clearPlansCache();
  const noShown = await tryCheckoutFor(yu, 'bolt', 'year');
  ok(noShown.code === 'billing_not_configured', 'a plan without a yearly price on the site can’t be bought yearly, even with a Stripe price');
  await db.query(`update public.billing_plans set yearly_price_cents = 9900 where key = 'bolt'`); config.clearPlansCache();
  // the webhook for a paid yearly subscription: Flash, 3 hours renewed monthly, yearly renewal date
  const ycust = (await db.query('select stripe_customer_id from public.subscriptions where user_id = $1', [yu])).rows[0].stripe_customer_id;
  subs.set('sub_year', subscription({ id: 'sub_year', customer: ycust, metadata: { supabase_user_id: yu, interval: 'year' }, items: { data: [{ id: 'si_y', price: { id: 'price_flashyear' }, current_period_start: now - 40 * 86400, current_period_end: now + 325 * 86400 }] } }));
  const yd = await deliver(event('evt_year', 'customer.subscription.created', { id: 'sub_year' }));
  const ys = await statusOf(yu);
  ok(yd.statusCode === 200 && ys.plan === 'flash' && ys.billingInterval === 'year' && ys.monthlySeconds === 10800, 'webhook: a yearly Flash price grants Flash (billed yearly)');
  ok(Date.parse(ys.renewsAt) === (now + 325 * 86400) * 1000 && Date.parse(ys.periodEnd) < Date.parse(ys.renewsAt) && Date.parse(ys.periodStart) > (now - 40 * 86400) * 1000,
    'yearly: this month’s allowance window, inside the yearly period (renewsAt = the yearly renewal)');
  ok(await config.planForPrice('price_boltyear') === 'bolt' && await config.planForPrice('price_bolt') === 'bolt' && await config.planForPrice('price_nope') === null, 'price → plan mapping covers monthly and yearly; unknown prices grant nothing');
  ok(JSON.stringify(await config.planAndIntervalForPrice('price_thunderyear')) === JSON.stringify({ plan: 'thunder', interval: 'year' }), 'the interval is known from the price too');
  // already paying yearly Flash: the same plan and interval again is refused; switching goes through the portal
  const again = await tryCheckoutFor(yu, 'flash', 'year');
  ok(again.code === 'already_on_plan' && /Flash \(yearly\)/.test(again.message), 'already on yearly Flash → “You’re already on Flash (yearly)”');
  subs.set('sub_year', { ...subs.get('sub_year'), status: 'canceled' });
  await deliver(event('evt_year_end', 'customer.subscription.deleted', { id: 'sub_year' }));
  ok((await statusOf(yu)).plan === 'free' && (await statusOf(yu)).billingInterval === null, 'yearly canceled and ended → Free');
}

// a Checkout that completes unpaid (a delayed payment method) doesn't use the offer
const pending = await P.createUser('pending@example.com');
await tryCheckoutFor(pending, 'flash');
const pcust = (await db.query('select stripe_customer_id from public.subscriptions where user_id = $1', [pending])).rows[0].stripe_customer_id;
subs.set('sub_pending', subscription({ id: 'sub_pending', customer: pcust, status: 'incomplete', metadata: { supabase_user_id: pending } }));
await deliver(event('evt_pending', 'checkout.session.completed', { id: 'cs_pending', mode: 'subscription', subscription: 'sub_pending', customer: pcust, client_reference_id: pending, metadata: { supabase_user_id: pending, plan: 'flash', intro: '1' }, total_details: { amount_discount: 499 }, payment_status: 'unpaid' }));
ok((await statusOf(pending)).introEligible === true, 'a Checkout that completes unpaid (delayed payment) does not use up the offer');
const declined = await P.createUser('declined@example.com');
const dc = await tryCheckoutFor(declined, 'flash');
const dcust = (await db.query('select stripe_customer_id from public.subscriptions where user_id = $1', [declined])).rows[0].stripe_customer_id;
subs.set('sub_declined', subscription({ id: 'sub_declined', customer: dcust, status: 'incomplete', metadata: { supabase_user_id: declined } }));
await deliver(event('evt_declined', 'customer.subscription.created', { id: 'sub_declined' }));
ok(dc.url && (await statusOf(declined)).plan === 'free' && (await statusOf(declined)).introEligible === true, 'a first payment that was declined (incomplete): no access, and the offer is still available');
subs.set('sub_declined', subscription({ id: 'sub_declined', customer: dcust, status: 'incomplete_expired', metadata: { supabase_user_id: declined } }));
await deliver(event('evt_declined_exp', 'customer.subscription.updated', { id: 'sub_declined' }));
ok((await statusOf(declined)).introEligible === true, '…also after Stripe expires that attempt');

// ---------- 4. duplicates, orphans, account deletion ----------
// two checkouts paid at the same moment: the newer subscription is canceled and refunded, the first stays
const sub2 = (id, created, o = {}) => subscription({ id, created, ...o });
subs.set('sub_qa_1', subscription({ status: 'canceled' }));
subs.set('sub_first', sub2('sub_first', now - 5));
subs.set('sub_second', sub2('sub_second', now));
invoices.set('in_second', { id: 'in_second', object: 'invoice', subscription: 'sub_second', amount_paid: 799, status: 'paid', pi: 'pi_second' });
await deliver(event('evt_first', 'checkout.session.completed', { id: 'cs_a', mode: 'subscription', subscription: 'sub_first', customer, client_reference_id: user }));
const dupDone = await deliver(event('evt_second', 'checkout.session.completed', { id: 'cs_b', mode: 'subscription', subscription: 'sub_second', customer, client_reference_id: user }));
ok(dupDone.statusCode === 200 && subs.get('sub_second').status === 'canceled' && subs.get('sub_first').status === 'active', 'two paid checkouts: the second subscription is canceled at once, the first kept');
ok(refunds.some((r) => r.pi === 'pi_second' && r.reason === 'duplicate'), '…and its payment is refunded (reason: duplicate)');
const afterDup = await statusOf(user);
ok(afterDup.plan === 'flash' && afterDup.subscriptionStatus === 'active', '…and the account keeps one active Flash plan');
const again = await deliver(event('evt_second_retry', 'customer.subscription.updated', { id: 'sub_second' }));
ok(again.statusCode === 200 && (await statusOf(user)).plan === 'flash', 'a late event for the canceled duplicate doesn’t take access away');
// the order seen in real Stripe test mode: the duplicate's own "created" event, then its "deleted" event
subs.set('sub_third', sub2('sub_third', now + 5, { items: { data: [{ id: 'si_3', price: { id: 'price_bolt' }, current_period_start: now, current_period_end: now + 30 * 86400 }] } }));
invoices.set('in_third', { id: 'in_third', object: 'invoice', subscription: 'sub_third', amount_paid: 1499, status: 'paid', pi: 'pi_third' });
await deliver(event('evt_third_created', 'customer.subscription.created', { id: 'sub_third', object: 'subscription' }));
await deliver(event('evt_third_deleted', 'customer.subscription.deleted', { id: 'sub_third', object: 'subscription' }));
const kept = await statusOf(user);
ok(subs.get('sub_third').status === 'canceled' && refunds.some((r) => r.pi === 'pi_third') && kept.plan === 'flash' && kept.subscriptionStatus === 'active',
  `a duplicate made outside Checkout is canceled and refunded, and the account keeps the subscription that stays (got ${kept.plan}/${kept.subscriptionStatus})`);

// a Checkout completed after the account was deleted: canceled and refunded, never charging a missing account
const ghost = '00000000-0000-4000-8000-00000000dead';
subs.set('sub_ghost', subscription({ id: 'sub_ghost', customer: 'cus_ghost', metadata: { supabase_user_id: ghost } }));
invoices.set('in_ghost', { id: 'in_ghost', object: 'invoice', subscription: 'sub_ghost', amount_paid: 1499, status: 'paid', pi: 'pi_ghost' });
const g = await deliver(event('evt_ghost', 'checkout.session.completed', { id: 'cs_g', mode: 'subscription', subscription: 'sub_ghost', customer: 'cus_ghost', client_reference_id: ghost }));
ok(g.statusCode === 200 && /unknown_user/.test(g.body.refused) && subs.get('sub_ghost').status === 'canceled' && refunds.some((r) => r.pi === 'pi_ghost'), 'payment for an account that no longer exists → subscription canceled and refunded');
// a renewal for an account removed by an administrator: canceled, only that renewal refunded
subs.set('sub_admin', subscription({ id: 'sub_admin', customer: 'cus_admin', metadata: { supabase_user_id: ghost } }));
invoices.set('in_admin_old', { id: 'in_admin_old', object: 'invoice', subscription: 'sub_admin', amount_paid: 799, status: 'paid', pi: 'pi_admin_old' });
invoices.set('in_admin_new', { id: 'in_admin_new', object: 'invoice', subscription: 'sub_admin', amount_paid: 799, status: 'paid', pi: 'pi_admin_new' });
const ad = await deliver(event('evt_admin', 'invoice.paid', { id: 'in_admin_new', object: 'invoice', subscription: 'sub_admin', customer: 'cus_admin' }));
ok(ad.statusCode === 200 && subs.get('sub_admin').status === 'canceled' && refunds.some((r) => r.pi === 'pi_admin_new') && !refunds.some((r) => r.pi === 'pi_admin_old'), 'a renewal charged after the account was removed → canceled, and only that renewal refunded');
// a subscription that isn't SparkScribe's (no account in its metadata) is only refused, never touched
ok(subs.get('sub_foreign').status === 'active', 'a subscription not created by SparkScribe is never canceled');
// the database lost the customer link, but Stripe's metadata names an existing account: relinked, not canceled
const third = await P.createUser('relink@example.com');
subs.set('sub_relink', subscription({ id: 'sub_relink', customer: 'cus_relink', metadata: { supabase_user_id: third } }));
const rl = await deliver(event('evt_relink', 'customer.subscription.updated', { id: 'sub_relink' }));
ok(rl.statusCode === 200 && subs.get('sub_relink').status === 'active' && (await statusOf(third)).plan === 'flash', 'an existing account whose link was lost is relinked from Stripe metadata (not canceled)');

// account deletion with an active subscription: canceled in Stripe first, then the account is deleted
const asUserSb = (uid, claims) => ({
  rpc: async (fn, args = {}) => {
    try {
      const keys = Object.keys(args);
      const r = await P.asUser(uid, (d) => d.query(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) r`, keys.map((k) => args[k])), claims);
      return { data: r.rows[0].r, error: null };
    } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
  },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: (await db.query('select stripe_customer_id, livemode from public.subscriptions where user_id = $1', [uid])).rows[0] || null }) }) }) }),
});
const t = () => Math.floor(Date.now() / 1000);
const stale = await service.deleteAccount(asUserSb(user, { amr: [{ method: 'password', timestamp: t() - 3600 }] }), { id: user });
ok(stale.deleted === false && stale.reason === 'reauth' && subs.get('sub_first').status === 'active', 'deletion without a recent sign-in: nothing canceled, nothing deleted');
const gone = await service.deleteAccount(asUserSb(user, { amr: [{ method: 'password', timestamp: t() - 30 }] }), { id: user });
ok(gone.deleted === true && subs.get('sub_first').status === 'canceled', 'deletion with a recent sign-in: the active subscription is canceled in Stripe, then the account deleted');
ok((await db.query('select count(*)::int n from auth.users where id = $1', [user])).rows[0].n === 0 && deletedCustomers.includes(customer), '…the account is gone and its Stripe customer (saved card) deleted');
const late = await deliver(event('evt_late', 'customer.subscription.deleted', { id: 'sub_first' }));
ok(late.statusCode === 200 && late.body.refused, 'Stripe’s later events for the deleted account are acknowledged and change nothing');

// a test-mode server (Preview on the shared database) can't touch an account with real billing
{
  const realUser = await P.createUser('real@example.com');
  await db.query(`insert into public.subscriptions (user_id, stripe_customer_id, livemode, plan, status) values ($1, 'cus_LIVE_real', true, 'flash', 'active')`, [realUser]);
  const before = stripeCalls.length;
  let err = null;
  try { await service.createCheckout(fakeSb(realUser), { id: realUser, email: 'real@example.com' }, 'bolt', 'http://localhost:5173'); } catch (e) { err = e; }
  const row = (await db.query('select stripe_customer_id, livemode from public.subscriptions where user_id = $1', [realUser])).rows[0];
  ok(err?.code === 'live_account' && row.stripe_customer_id === 'cus_LIVE_real' && row.livemode === true && !stripeCalls.slice(before).includes('POST /v1/customers'),
    'a test checkout never replaces a live customer link (the real subscription stays attached)');
}

delete process.env.STRIPE_WEBHOOK_SECRET;
ok((await deliver(event('evt_x', 'customer.subscription.updated', { id: 'sub_qa_1' }))).statusCode === 503, 'webhook without its secret configured → 503 (nothing processed)');

console.log = quiet;
rest.close(); fake.close();
console.log(`\n${pass} checks passed`);
