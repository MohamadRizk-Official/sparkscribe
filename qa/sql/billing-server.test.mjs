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
      const r = await P.asAnon((d) => d.query(`select key, name, tagline, price_cents, currency, billing_interval, monthly_seconds, sort_order, is_default from public.billing_plans where active order by sort_order`));
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
const fake = http.createServer(async (req, res) => {
  const body = await new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
  stripeCalls.push(`${req.method} ${req.url.split('?')[0]}`);
  const send = (obj, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const path = req.url.split('?')[0];
  if (path === '/v1/customers' && req.method === 'POST') return send({ id: `cus_${nextId++}`, object: 'customer' });
  if (path === '/v1/subscriptions' && req.method === 'GET') return send({ object: 'list', data: [], has_more: false });
  if (path === '/v1/checkout/sessions' && req.method === 'POST') return send({ id: 'cs_test_1', object: 'checkout.session', url: 'https://checkout.stripe.test/cs_test_1', body });
  const m = /^\/v1\/subscriptions\/(sub_[a-z0-9_]+)$/.exec(path);
  if (m && subs.has(m[1])) return send(subs.get(m[1]));
  send({ error: { type: 'invalid_request_error', message: 'No such resource' } }, 404);
});
const stripePort = await listen(fake);

Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${restPort}`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_qa',
  BILLING_DB_SECRET: SECRET, STRIPE_WEBHOOK_SECRET: 'whsec_qa_test', STRIPE_API_HOST: `127.0.0.1:${stripePort}`,
  STRIPE_PLUS_PRICE_ID: 'price_plus', STRIPE_PRO_PRICE_ID: 'price_pro',
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

const fakeSb = (uid) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: (await db.query('select stripe_customer_id, livemode from public.subscriptions where user_id = $1', [uid])).rows[0] || null }) }) }) }) });
const tryCheckout = async (plan = 'plus') => { try { return await service.createCheckout(fakeSb(user), { id: user, email: 'payer@example.com' }, plan, 'http://localhost:5173'); } catch (e) { return e; } };
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
const c = await tryCheckout('plus');
ok(c.url === 'https://checkout.stripe.test/cs_test_1' && stripeCalls.includes('POST /v1/customers') && stripeCalls.includes('POST /v1/checkout/sessions'), 'test mode + switch: Checkout session created (fake Stripe)');
const linked = (await db.query('select stripe_customer_id, livemode from public.subscriptions where user_id = $1', [user])).rows[0];
ok(linked?.stripe_customer_id?.startsWith('cus_') && linked.livemode === false, 'the Stripe customer is linked to this account (test mode)');
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
const subscription = (o = {}) => ({ id: 'sub_qa_1', object: 'subscription', customer, status: 'active', livemode: false, metadata: { supabase_user_id: user }, cancel_at_period_end: false, cancel_at: null, canceled_at: null, items: { data: [{ id: 'si_1', price: { id: 'price_plus' }, current_period_start: now, current_period_end: now + 30 * 86400 }] }, ...o });
const event = (id, type, object, o = {}) => ({ id, object: 'event', type, livemode: false, data: { object }, ...o });

ok((await deliver(event('evt_a', 'customer.subscription.updated', { id: 'sub_qa_1' }), { method: 'GET' })).statusCode === 405, 'webhook: only POST');
ok((await deliver(event('evt_a', 'customer.subscription.updated', { id: 'sub_qa_1' }), { sig: null })).statusCode === 400, 'webhook: missing signature → 400');
ok((await deliver(event('evt_a', 'customer.subscription.updated', { id: 'sub_qa_1' }), { secret: 'whsec_attacker' })).statusCode === 400, 'webhook: signed with the wrong secret → 400');
ok((await deliver(event('evt_a', 'customer.subscription.updated', { id: 'sub_qa_1' }), { timestamp: now - 3600 })).statusCode === 400, 'webhook: replayed old delivery (1 h) → 400');
ok((await statusOf(user)).plan === 'free', '…and none of those changed anything');

subs.set('sub_qa_1', subscription());
const r1 = await deliver(event('evt_checkout', 'checkout.session.completed', { id: 'cs_test_1', mode: 'subscription', subscription: 'sub_qa_1', customer, client_reference_id: user, metadata: { supabase_user_id: user } }));
ok(r1.statusCode === 200 && (await statusOf(user)).plan === 'plus', 'checkout.session.completed (valid signature) → Plus, from Stripe’s own subscription record');
const dup = await deliver(event('evt_checkout', 'checkout.session.completed', { id: 'cs_test_1', mode: 'subscription', subscription: 'sub_qa_1', customer, client_reference_id: user }));
ok(dup.statusCode === 200 && dup.body.duplicate === true, 'the same event again → acknowledged as duplicate, not re-applied');

subs.set('sub_qa_1', subscription({ items: { data: [{ id: 'si_1', price: { id: 'price_pro' }, current_period_start: now, current_period_end: now + 30 * 86400 }] } }));
await deliver(event('evt_up', 'customer.subscription.updated', { id: 'sub_qa_1' }));
ok((await statusOf(user)).plan === 'pro', 'upgrade (subscription.updated) → Pro');
subs.set('sub_qa_1', subscription({ status: 'past_due' }));
const pf = await deliver(event('evt_fail', 'invoice.payment_failed', { id: 'in_1', subscription: 'sub_qa_1', customer }));
const sp = await statusOf(user);
ok(pf.statusCode === 200 && sp.plan === 'plus' && sp.paymentProblem, 'invoice.payment_failed → access kept while Stripe retries, problem shown');
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
const logged = (await db.query(`select id, result from public.billing_events order by created_at`)).rows.map((r) => `${r.id}:${r.result}`);
ok(logged.includes('evt_checkout:synced') && logged.includes('evt_foreign:refused:unknown_customer'), `every processed event is logged with its outcome (${logged.length} events)`);

delete process.env.STRIPE_WEBHOOK_SECRET;
ok((await deliver(event('evt_x', 'customer.subscription.updated', { id: 'sub_qa_1' }))).statusCode === 503, 'webhook without its secret configured → 503 (nothing processed)');

console.log = quiet;
rest.close(); fake.close();
console.log(`\n${pass} checks passed`);
