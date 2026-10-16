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
      const r = await P.asAnon((d) => d.query(`select key, name, tagline, price_cents, currency, billing_interval, monthly_seconds, tier, features, intro_price_cents, intro_months, is_default from public.billing_plans where tier is not null order by tier`));
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
const tryCheckout = async (plan = 'flash') => { try { return await service.createCheckout(fakeSb(user), { id: user, email: 'payer@example.com' }, plan, 'http://localhost:5173'); } catch (e) { return e; } };
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
const r1 = await deliver(event('evt_checkout', 'checkout.session.completed', { id: 'cs_test_1', mode: 'subscription', subscription: 'sub_qa_1', customer, client_reference_id: user, metadata: { supabase_user_id: user } }));
ok(r1.statusCode === 200 && (await statusOf(user)).plan === 'flash', 'checkout.session.completed (valid signature) → Flash, from Stripe’s own subscription record');
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
const logged = (await db.query(`select id, result from public.billing_events order by created_at`)).rows.map((r) => `${r.id}:${r.result}`);
ok(logged.includes('evt_checkout:synced') && logged.includes('evt_foreign:refused:unknown_customer'), `every processed event is logged with its outcome (${logged.length} events)`);

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
