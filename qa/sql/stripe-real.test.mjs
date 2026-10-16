// REAL Stripe TEST-mode billing scenarios (Master Phase 4), end to end through SparkScribe's own server code:
//   real Stripe sandbox (products, prices, the Flash coupon, subscriptions, invoices, proration, test clocks for renewals,
//   test payment methods) + the real billing server modules + every database migration on an isolated Postgres
//   (PGlite, synthetic users) + Stripe's real events, read back from the API and delivered to the local webhook handler
//   with a locally signed header. No production data and no production database are touched.
//
//   node qa/sql/stripe-real.test.mjs            → qa/out/stripe-real.json
//
// Safety: refuses anything but an sk_test_ key. Every customer and subscription it creates is tagged
// sparkscribe_scope=qa-local, which deployed webhooks ignore (server/billing/config.js billingScope). Webhook
// endpoints of deployments without that check must be disabled first (the script refuses to run otherwise). Everything
// it creates in Stripe (customers, test clocks) is deleted at the end.
// Not covered here (needs a person): paying on Stripe's hosted Checkout page. Checkout sessions are created by the real
// server code and their amounts read back from Stripe; their completion is reproduced by creating the same subscription
// through the API and delivering a checkout.session.completed event built from that session.
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { freshDb } from './pg.mjs';
import Stripe from 'stripe';

const ROOT = new URL('../../', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env.local', ROOT), 'utf8').split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()]));
const KEY = env.STRIPE_SECRET_KEY || '';
if (!KEY.startsWith('sk_test_')) { console.error('Only a Stripe TEST key is accepted.'); process.exit(1); }
const stripe = new Stripe(KEY);
const results = [];
let pass = 0;
const ok = (c, m, extra) => { results.push({ ok: !!c, check: m, ...(extra && { detail: extra }) }); assert.ok(c, m); pass++; console.log('ok -', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const unix = () => Math.floor(Date.now() / 1000);

// ---------- refuse to run while a deployment that doesn't know scopes would receive these events ----------
const ENDPOINTS_THAT_IGNORE_QA = [/sparkscribe-git-release-four-tier-moerizz\.vercel\.app/];
for (const w of (await stripe.webhookEndpoints.list({ limit: 50 })).data) {
  if (w.status === 'enabled' && !ENDPOINTS_THAT_IGNORE_QA.some((re) => re.test(w.url))) {
    console.error(`Webhook endpoint ${w.id} is enabled and its deployment may not ignore qa-local objects. Disable it first (Stripe test mode).`);
    process.exit(2);
  }
}

// ---------- prices and the coupon, as the setup script made them ----------
const priceFor = async (key, cents) => (await stripe.prices.list({ lookup_keys: [`sparkscribe_${key}_monthly_${cents}`], limit: 1 })).data[0]?.id;
const PRICE = { flash: await priceFor('flash', 599), bolt: await priceFor('bolt', 999), thunder: await priceFor('thunder', 1499) };
const COUPON = 'sparkscribe_flash_intro_499_1m';
// the four-tier Customer Portal configuration made by scripts/stripe-setup.mjs (the account's default one only knows Plus/Pro)
const PORTAL = (await stripe.billingPortal.configurations.list({ active: true, limit: 50 })).data.find((c) => c.metadata?.sparkscribe === 'portal_four_tier')?.id;
assert.ok(PRICE.flash && PRICE.bolt && PRICE.thunder, 'run scripts/stripe-setup.mjs first');

// ---------- isolated database + PostgREST stand-in for the server's anonymous calls ----------
const P = await freshDb();
const { db } = P;
const SECRET = 'qa-billing-secret';
await db.query(`insert into private.billing_secrets (name, hash) values ('server', sha256(convert_to($1, 'UTF8')))`, [SECRET]);
const statusOf = (uid) => P.asUser(uid, async (d) => (await d.query('select public.billing_status() r')).rows[0].r);
const rest = http.createServer(async (req, res) => {
  const body = await new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
  const url = new URL(req.url, 'http://x');
  const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  try {
    const rpc = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
    if (rpc) { const a = JSON.parse(body || '{}'); const k = Object.keys(a); return send(200, (await P.asAnon((d) => d.query(`select public.${rpc[1]}(${k.map((x, i) => `${x} => $${i + 1}`).join(', ')}) r`, k.map((x) => a[x])))).rows[0].r); }
    if (url.pathname === '/rest/v1/billing_plans') return send(200, (await P.asAnon((d) => d.query(`select key, name, tagline, price_cents, currency, billing_interval, monthly_seconds, tier, features, intro_price_cents, intro_months, is_default from public.billing_plans where tier is not null order by tier`))).rows);
    send(404, { code: 'PGRST125', message: 'not in the stand-in' });
  } catch (e) { send(400, { code: e.code || 'P0001', message: e.message }); }
});
await new Promise((r) => rest.listen(0, '127.0.0.1', r));
const WHSEC = 'whsec_qa_local_only';
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${rest.address().port}`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_qa',
  BILLING_DB_SECRET: SECRET, STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: WHSEC, BILLING_PAYMENTS_ENABLED: '1', BILLING_SCOPE: 'qa-local',
  STRIPE_FLASH_PRICE_ID: PRICE.flash, STRIPE_BOLT_PRICE_ID: PRICE.bolt, STRIPE_THUNDER_PRICE_ID: PRICE.thunder, STRIPE_FLASH_INTRO_COUPON: COUPON,
  STRIPE_PORTAL_CONFIGURATION_ID: PORTAL,
});
delete process.env.VERCEL; delete process.env.STRIPE_API_HOST; delete process.env.STRIPE_AUTOMATIC_TAX;
const quiet = console.log; console.log = (...a) => { if (!String(a[0]).startsWith('[billing]')) quiet(...a); };
const alerts = []; const err0 = console.error; console.error = (...a) => { const s = a.join(' '); if (s.includes('"alert":true')) alerts.push(s); else err0(...a); };
const service = await import(new URL('server/billing/service.js', ROOT).href);
const webhook = (await import(new URL('api/stripe-webhook.js', ROOT).href)).default;

// the signed-in user's client, as the billing server uses it
const userSb = (uid, { recentSignIn = false } = {}) => {
  const claims = recentSignIn ? { amr: [{ method: 'password', timestamp: unix() }] } : {};
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: (await db.query('select stripe_customer_id, livemode, stripe_subscription_id, stripe_price_id from public.subscriptions where user_id = $1', [uid])).rows[0] || null }) }) }) }),
    rpc: async (fn, args = {}) => {
      try {
        const k = Object.keys(args);
        const r = await P.asUser(uid, (d) => d.query(`select public.${fn}(${k.map((x, i) => `${x} => $${i + 1}`).join(', ')}) r`, k.map((x) => args[x])), claims);
        return { data: r.rows[0].r, error: null };
      } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
    },
  };
};

// ---------- Stripe's real events → the local webhook (locally signed) ----------
const created = { customers: new Set(), clocks: new Set() };
const seen = new Set();
const deliver = async (event, { secret = WHSEC, sig } = {}) => {
  const payload = JSON.stringify(event);
  const header = sig ?? stripe.webhooks.generateTestHeaderString({ payload, secret });
  const req = Readable.from([Buffer.from(payload)]);
  req.method = 'POST'; req.headers = { 'stripe-signature': header };
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); } };
  await webhook(req, res);
  return res;
};
// every event Stripe made about our customers since `since`, oldest first, each delivered once
async function pump(since) {
  for (let round = 0; round < 3; round++) {
    const evs = [];
    for await (const e of stripe.events.list({ created: { gte: since - 5 }, limit: 100 })) {
      const o = e.data.object;
      const cus = typeof o.customer === 'string' ? o.customer : o.customer?.id || (o.object === 'customer' ? o.id : null);
      if (cus && created.customers.has(cus) && !seen.has(e.id)) evs.push(e);
    }
    evs.sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
    for (const e of evs) { seen.add(e.id); await deliver(e); }
    await sleep(1500);
  }
}
async function newUser(label, { clock = false } = {}) {
  const uid = await P.createUser(`${label}@qa.local`);
  let testClock = null;
  if (clock) { testClock = await stripe.testHelpers.testClocks.create({ frozen_time: unix(), name: `qa ${label}` }); created.clocks.add(testClock.id); }
  const cus = await stripe.customers.create({ email: `${label}@qa.local`, metadata: { supabase_user_id: uid, sparkscribe_scope: 'qa-local' }, ...(testClock && { test_clock: testClock.id }) });
  created.customers.add(cus.id);
  await P.asAnon((d) => d.query(`select public.billing_link_customer($1, $2, $3, false)`, [SECRET, uid, cus.id]));
  return { uid, customer: cus.id, clock: testClock?.id || null, email: `${label}@qa.local` };
}
const card = async (customer, token) => {
  const pm = await stripe.paymentMethods.attach(token, { customer });
  await stripe.customers.update(customer, { invoice_settings: { default_payment_method: pm.id } });
  return pm.id;
};
async function advance(clockId, seconds) {
  const c = await stripe.testHelpers.testClocks.retrieve(clockId);
  await stripe.testHelpers.testClocks.advance(clockId, { frozen_time: c.frozen_time + seconds });
  for (let i = 0; i < 90; i++) { await sleep(2000); if ((await stripe.testHelpers.testClocks.retrieve(clockId)).status === 'ready') return; }
  throw new Error('test clock did not finish advancing');
}
// "complete" a Checkout the way Stripe would: the same subscription (price, coupon, metadata), then the event built from
// the real session (with the discount Stripe actually applied to the first invoice)
async function completeCheckout(u, session, { token = 'pm_card_visa' } = {}) {
  const s = await stripe.checkout.sessions.retrieve(session.id, { expand: ['line_items', 'discounts'] });
  const pm = await card(u.customer, token);
  const sub = await stripe.subscriptions.create({
    customer: u.customer, items: [{ price: s.line_items.data[0].price.id }], default_payment_method: pm, payment_behavior: 'allow_incomplete',
    ...(s.discounts?.length && { discounts: s.discounts.map((d) => ({ coupon: typeof d.coupon === 'string' ? d.coupon : d.coupon?.id })) }),
    metadata: s.metadata, expand: ['latest_invoice'],
  });
  const inv = sub.latest_invoice;
  const evt = { id: `evt_qa_cs_${s.id.slice(-12)}`, object: 'event', type: 'checkout.session.completed', livemode: false, created: unix(),
    data: { object: { ...s, status: 'complete', subscription: sub.id, payment_status: inv.status === 'paid' ? 'paid' : 'unpaid', total_details: { ...s.total_details, amount_discount: inv.total_discount_amounts?.reduce((t, x) => t + x.amount, 0) ?? s.total_details?.amount_discount ?? 0 } } } };
  return { sub, invoice: inv, delivered: await deliver(evt) };
}
const stripeSub = (id) => stripe.subscriptions.retrieve(id, { expand: ['items.data.price'] });
const invoicesOf = async (sub) => (await stripe.invoices.list({ subscription: sub, limit: 20 })).data.sort((a, b) => a.created - b.created);

const out = { prices: PRICE, coupon: COUPON, scenarios: {} };
try {
  const since = unix();

  // 1–2. Flash $1 first month, then $5.99 at renewal (test clock)
  const f = await newUser('flash-intro', { clock: true });
  ok((await statusOf(f.uid)).introEligible === true, '1 · new account: eligible for the $1 first month');
  const cs = await service.createCheckout(userSb(f.uid), { id: f.uid, email: f.email }, 'flash', 'http://localhost:5173');
  const sess = await stripe.checkout.sessions.retrieve(cs.url.split('/').pop().split('#')[0]).catch(() => null) || (await stripe.checkout.sessions.list({ customer: f.customer, limit: 1 })).data[0];
  ok(sess.amount_subtotal === 599 && sess.total_details.amount_discount === 499 && sess.amount_total === 100, `1 · Checkout (real Stripe session) shows $5.99 − $4.99 = $1.00 today (${sess.amount_subtotal}/${sess.total_details.amount_discount}/${sess.amount_total})`);
  const fl = await completeCheckout(f, sess);
  await pump(since);
  ok(fl.invoice.total === 100 && fl.invoice.status === 'paid', `1 · first invoice: $1.00, paid (${fl.invoice.total})`);
  let st = await statusOf(f.uid);
  ok(st.plan === 'flash' && st.monthlySeconds === 10800 && st.introEligible === false, '1 · the account is on Flash (3 h) and the offer is used up');
  await P.asUser(f.uid, (d) => d.query(`insert into public.transcriptions (title, transcript_text, duration_seconds, segments) values ('t', 'x', 600, '[]')`));
  await db.query(`update public.billing_settings set metering_starts_at = now() - interval '1 day'`);
  ok(Number((await statusOf(f.uid)).usedSeconds) === 600, '1 · usage counts in the first period');
  await advance(f.clock, 32 * 86400);
  await pump(since);
  const fInv = await invoicesOf(fl.sub.id);
  ok(fInv.length >= 2 && fInv[1].total === 599 && fInv[1].status === 'paid' && !fInv[1].discounts?.length, `2 · first renewal: $5.99, paid, no discount (${fInv.map((i) => `${i.total}/${i.status}`).join(', ')})`);
  st = await statusOf(f.uid);
  const sNow = await stripeSub(fl.sub.id);
  ok(st.plan === 'flash' && new Date(st.periodStart).getTime() / 1000 === sNow.items.data[0].current_period_start, '2 · still Flash; the period advanced to Stripe’s new period');
  // usage is counted by real time; the test clock moved Stripe's period into the future, so the usage of "now" is
  // before the new period start and doesn't count against it
  ok(Number(st.usedSeconds) === 0, '2 · the new period starts with the full allowance');
  out.scenarios.flashIntro = { invoices: fInv.map((i) => ({ total: i.total, status: i.status, discount: (i.total_discount_amounts || []).reduce((t, x) => t + x.amount, 0) })) };

  // 3. returning customer: no $1 again
  await stripe.subscriptions.cancel(fl.sub.id);
  await pump(since);
  ok((await statusOf(f.uid)).plan === 'free', '3 · canceled → Free');
  await service.createCheckout(userSb(f.uid), { id: f.uid, email: f.email }, 'flash', 'http://localhost:5173');
  const again = (await stripe.checkout.sessions.list({ customer: f.customer, limit: 1 })).data[0];
  ok(again.amount_total === 599 && !(again.total_details?.amount_discount), `3 · coming back: Checkout is $5.99 (no second $1 month) (${again.amount_total})`);

  // 4–5. Bolt and Thunder purchases
  for (const [plan, cents] of [['bolt', 999], ['thunder', 1499]]) {
    const u = await newUser(`${plan}-buy`);
    await service.createCheckout(userSb(u.uid), { id: u.uid, email: u.email }, plan, 'http://localhost:5173');
    const s2 = (await stripe.checkout.sessions.list({ customer: u.customer, limit: 1 })).data[0];
    const done = await completeCheckout(u, s2);
    await pump(since);
    const stp = await statusOf(u.uid);
    ok(s2.amount_total === cents && done.invoice.total === cents && stp.plan === plan, `${plan === 'bolt' ? 4 : 5} · ${plan}: Checkout $${cents / 100}, invoice $${done.invoice.total / 100}, account on ${stp.plan}`);
    if (plan === 'thunder') ok(stp.features.includes('across_ask') && stp.features.includes('across_guide'), '5 · Thunder unlocks asking across recordings and combined guides');
    out.scenarios[plan] = { checkout: s2.amount_total, invoice: done.invoice.total };
  }

  // 6. Flash ($1) → Bolt ten days later: what Stripe charges at once
  const up = await newUser('flash-to-bolt', { clock: true });
  await service.createCheckout(userSb(up.uid), { id: up.uid, email: up.email }, 'flash', 'http://localhost:5173');
  const upS = await completeCheckout(up, (await stripe.checkout.sessions.list({ customer: up.customer, limit: 1 })).data[0]);
  await pump(since);
  await advance(up.clock, 10 * 86400);
  const s6 = await stripeSub(upS.sub.id);
  await stripe.subscriptions.update(s6.id, { items: [{ id: s6.items.data[0].id, price: PRICE.bolt }], proration_behavior: 'always_invoice' }); // as the Customer Portal does
  await sleep(3000);
  await pump(since);
  const inv6 = (await invoicesOf(s6.id)).at(-1);
  const lines6 = (await stripe.invoices.listLineItems(inv6.id, { limit: 20 })).data.map((l) => ({ description: l.description, amount: l.amount }));
  const st6 = await statusOf(up.uid);
  ok(st6.plan === 'bolt' && inv6.status === 'paid', `6 · Flash → Bolt during the $1 month: Bolt at once, the prorated invoice paid (${inv6.total})`);
  out.scenarios.flashToBoltDuringPromo = { paidFirst: upS.invoice.total, upgradeInvoice: inv6.total, lines: lines6 };

  // 7. Bolt → Thunder (immediate, prorated); 8. Thunder → Bolt at the end of the period (as the portal schedules it)
  const bt = await newUser('bolt-thunder', { clock: true });
  await service.createCheckout(userSb(bt.uid), { id: bt.uid, email: bt.email }, 'bolt', 'http://localhost:5173');
  const btS = await completeCheckout(bt, (await stripe.checkout.sessions.list({ customer: bt.customer, limit: 1 })).data[0]);
  await pump(since);
  await advance(bt.clock, 15 * 86400);
  let s7 = await stripeSub(btS.sub.id);
  await stripe.subscriptions.update(s7.id, { items: [{ id: s7.items.data[0].id, price: PRICE.thunder }], proration_behavior: 'always_invoice' });
  await sleep(3000); await pump(since);
  const inv7 = (await invoicesOf(s7.id)).at(-1);
  ok((await statusOf(bt.uid)).plan === 'thunder' && inv7.status === 'paid' && inv7.total > 0 && inv7.total < 1499, `7 · Bolt → Thunder mid-period: Thunder at once, prorated difference paid ($${(inv7.total / 100).toFixed(2)})`);
  out.scenarios.boltToThunder = { invoice: inv7.total };
  s7 = await stripeSub(btS.sub.id);
  const sched = await stripe.subscriptionSchedules.create({ from_subscription: s7.id });
  await stripe.subscriptionSchedules.update(sched.id, { end_behavior: 'release', phases: [
    { items: [{ price: PRICE.thunder, quantity: 1 }], start_date: sched.phases[0].start_date, end_date: s7.items.data[0].current_period_end, proration_behavior: 'none' },
    { items: [{ price: PRICE.bolt, quantity: 1 }], proration_behavior: 'none', duration: { interval: 'month', interval_count: 1 } },
  ] });
  await sleep(2000); await pump(since);
  ok((await statusOf(bt.uid)).plan === 'thunder', '8 · Thunder → Bolt scheduled for the end of the period: Thunder kept until then');
  const pending = await service.scheduledChange(userSb(bt.uid), { id: bt.uid });
  ok(pending?.plan === 'bolt' && Math.abs(new Date(pending.at).getTime() / 1000 - s7.items.data[0].current_period_end) < 5, `8 · the Account page can show "Switches to Bolt on ${pending?.at?.slice(0, 10)}" (read from Stripe)`);
  await advance(bt.clock, 16 * 86400);
  await pump(since);
  const inv8 = (await invoicesOf(s7.id)).at(-1);
  ok((await statusOf(bt.uid)).plan === 'bolt' && inv8.total === 999, `8 · at renewal the account is on Bolt and pays $9.99 (${inv8.total})`);

  // 9. cancel at the end of the period (the portal releases a finished schedule itself; done here as it would)
  const sch = (await stripe.subscriptions.retrieve(s7.id)).schedule;
  if (sch) await stripe.subscriptionSchedules.release(typeof sch === 'string' ? sch : sch.id);
  await stripe.subscriptions.update(s7.id, { cancel_at_period_end: true });
  await sleep(2000); await pump(since);
  st = await statusOf(bt.uid);
  ok(st.plan === 'bolt' && st.cancelAtPeriodEnd === true, '9 · canceled at period end: Bolt kept until then, shown as ending');
  await advance(bt.clock, 32 * 86400);
  await pump(since);
  ok((await statusOf(bt.uid)).plan === 'free', '9 · after the period: Free (nothing charged)');

  // 10–11. failed renewal, then recovery
  const fr = await newUser('failed-renewal', { clock: true });
  await service.createCheckout(userSb(fr.uid), { id: fr.uid, email: fr.email }, 'bolt', 'http://localhost:5173');
  const frS = await completeCheckout(fr, (await stripe.checkout.sessions.list({ customer: fr.customer, limit: 1 })).data[0]);
  await pump(since);
  const bad = await card(fr.customer, 'pm_card_chargeCustomerFail');
  await stripe.subscriptions.update(frS.sub.id, { default_payment_method: bad });
  await advance(fr.clock, 32 * 86400);
  await pump(since);
  st = await statusOf(fr.uid);
  ok(st.plan === 'bolt' && st.paymentProblem === true && st.subscriptionStatus === 'past_due', `10 · renewal declined: past_due, Bolt kept while Stripe retries, payment warning shown (${st.subscriptionStatus})`);
  const good = await card(fr.customer, 'pm_card_visa');
  await stripe.subscriptions.update(frS.sub.id, { default_payment_method: good });
  for (const inv of (await stripe.invoices.list({ subscription: frS.sub.id, status: 'open', limit: 5 })).data) await stripe.invoices.pay(inv.id, { payment_method: good });
  await sleep(2000); await pump(since);
  st = await statusOf(fr.uid);
  ok(st.plan === 'bolt' && !st.paymentProblem && st.subscriptionStatus === 'active', '11 · card replaced and invoice paid: active again, warning gone');

  // 12. a declined first payment
  const dc = await newUser('declined');
  await service.createCheckout(userSb(dc.uid), { id: dc.uid, email: dc.email }, 'flash', 'http://localhost:5173');
  const dcS = await completeCheckout(dc, (await stripe.checkout.sessions.list({ customer: dc.customer, limit: 1 })).data[0], { token: 'pm_card_chargeCustomerFail' });
  await pump(since);
  st = await statusOf(dc.uid);
  ok(dcS.sub.status === 'incomplete' && st.plan === 'free' && st.introEligible === true, `12 · declined first payment: incomplete, no access, the $1 offer still available (${dcS.sub.status})`);
  await stripe.subscriptions.cancel(dcS.sub.id).catch(() => {});

  // 13. two Checkouts (another tab): only the newest stays open
  const dbl = await newUser('double');
  const c1 = await service.createCheckout(userSb(dbl.uid), { id: dbl.uid, email: dbl.email }, 'thunder', 'http://localhost:5173');
  const c2 = await service.createCheckout(userSb(dbl.uid), { id: dbl.uid, email: dbl.email }, 'thunder', 'http://localhost:5173');
  const sessions = (await stripe.checkout.sessions.list({ customer: dbl.customer, limit: 5 })).data;
  ok(c1.url !== c2.url && sessions.filter((s) => s.status === 'open').length === 1 && sessions.some((s) => s.status === 'expired'), '13 · a second Checkout expires the first: only one can be paid');

  // 14–16. duplicate, out-of-order and forged webhooks (real events)
  await pump(since);
  // an event that was already delivered once (and processed)
  const anyEvent = await stripe.events.retrieve([...seen].find((id) => id.startsWith('evt_') && !id.startsWith('evt_qa_')));
  ok((await deliver(anyEvent)).body.duplicate === true, '14 · a real event delivered again → acknowledged as a duplicate, not re-applied');
  const before16 = JSON.stringify(await statusOf(fr.uid));
  const oldest = (await stripe.events.list({ created: { gte: since - 5 }, type: 'customer.subscription.created', limit: 50 })).data.find((e) => e.data.object.customer === fr.customer);
  await deliver({ ...oldest, id: `${oldest.id}_late` });
  ok(JSON.stringify(await statusOf(fr.uid)) === before16, '15 · an old event arriving late changes nothing (the server reads the subscription fresh from Stripe)');
  ok((await deliver(anyEvent, { secret: 'whsec_attacker' })).statusCode === 400, '16 · a forged signature → 400, nothing processed');

  // 17. deleting an account with an active Thunder subscription
  const del = await newUser('delete-me');
  await service.createCheckout(userSb(del.uid), { id: del.uid, email: del.email }, 'thunder', 'http://localhost:5173');
  const delS = await completeCheckout(del, (await stripe.checkout.sessions.list({ customer: del.customer, limit: 1 })).data[0]);
  await pump(since);
  const r17 = await service.deleteAccount(userSb(del.uid, { recentSignIn: true }), { id: del.uid });
  const delSub = await stripe.subscriptions.retrieve(delS.sub.id);
  const delCus = await stripe.customers.retrieve(del.customer);
  ok(r17.deleted && delSub.status === 'canceled' && delCus.deleted === true && (await db.query('select count(*)::int n from auth.users where id = $1', [del.uid])).rows[0].n === 0,
    '17 · account deletion: the Thunder subscription is canceled in Stripe, the customer deleted, the account and its data gone');
  created.customers.delete(del.customer);

  // 18. a price the server doesn't know
  const unk = await newUser('unknown-price');
  const odd = await stripe.prices.create({ currency: 'usd', unit_amount: 4200, recurring: { interval: 'month' }, product_data: { name: 'QA unknown price' } });
  await card(unk.customer, 'pm_card_visa');
  await stripe.subscriptions.create({ customer: unk.customer, items: [{ price: odd.id }], metadata: { supabase_user_id: unk.uid, sparkscribe_scope: 'qa-local' } });
  await pump(since);
  ok((await statusOf(unk.uid)).plan === 'free' && alerts.some((a) => a.includes(odd.id)), '18 · an unknown Stripe price grants nothing (Free) and raises an operator alert');
  await stripe.products.update(typeof odd.product === 'string' ? odd.product : odd.product.id, { active: false }).catch(() => {}); // archive the QA product

  // 19. Customer Portal sessions (the server's own configuration)
  const portal = await service.createPortal(userSb(fr.uid), { id: fr.uid }, 'http://localhost:5173');
  ok(/^https:\/\/billing\.stripe\.com\//.test(portal.url), '19 · Manage Billing opens a real Customer Portal session for the account’s own customer');
  const change = await service.createCheckout(userSb(fr.uid), { id: fr.uid, email: fr.email }, 'thunder', 'http://localhost:5173');
  ok(change.kind === 'change' && /^https:\/\/billing\.stripe\.com\//.test(change.url), '19 · a subscriber choosing another plan is sent to confirm the change in the portal (no second subscription)');

  // 20. Stripe and the database agree for every account
  const accounts = [f, up, bt, fr, dc, dbl, unk];
  const mismatches = [];
  for (const u of accounts) {
    const subs = (await stripe.subscriptions.list({ customer: u.customer, status: 'all', limit: 10 })).data;
    const paying = subs.filter((s) => ['active', 'trialing', 'past_due'].includes(s.status));
    const stx = await statusOf(u.uid);
    const want = paying.length ? Object.entries(PRICE).find(([, id]) => id === paying[0].items.data[0].price.id)?.[0] || 'free' : 'free';
    if (paying.length > 1 || stx.plan !== want) mismatches.push({ customer: u.customer, stripe: want, db: stx.plan, paying: paying.length });
  }
  ok(!mismatches.length, `20 · Stripe and the database agree for all ${accounts.length} accounts (at most one paying subscription each)`, mismatches);
} finally {
  // ---------- clean up everything this run created in Stripe ----------
  for (const c of created.customers) await stripe.customers.del(c).catch(() => {});
  for (const t of created.clocks) await stripe.testHelpers.testClocks.del(t).catch(() => {});
  console.log = quiet; console.error = err0;
  rest.close();
  mkdirSync(new URL('qa/out/', ROOT), { recursive: true });
  writeFileSync(new URL('qa/out/stripe-real.json', ROOT), JSON.stringify({ ...out, results }, null, 2));
}
console.log(`\n${pass} checks passed (real Stripe test mode)`);
