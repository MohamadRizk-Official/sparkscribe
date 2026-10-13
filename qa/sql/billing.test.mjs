// SQL-level tests of the billing schema that is live (inert) in production: plans, entitlements, minute metering,
// the quota, subscription changes, webhook idempotency and the server-secret gate. Isolated PGlite database with
// every production migration; no network, no Stripe.   node qa/sql/billing.test.mjs
import assert from 'node:assert/strict';
import { freshDb } from './pg.mjs';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const rejects = async (p, re, m) => { let err = null; try { await p; } catch (e) { err = e; } ok(err && re.test(err.message), `${m} (${err ? err.message.slice(0, 60) : 'no error'})`); };

const P = await freshDb({ proposed: true });
const { db } = P;
const SECRET = 'qa-billing-secret';
await db.query(`insert into private.billing_secrets (name, hash) values ('server', sha256(convert_to($1, 'UTF8')))`, [SECRET]);
const call = (fn, args) => P.asAnon(async (d) => {   // the webhook runs as anon; the secret is the gate
  const keys = Object.keys(args);
  const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) r`;
  return (await d.query(sql, keys.map((k) => args[k]))).rows[0].r;
});
const status = (uid) => P.asUser(uid, async (d) => (await d.query('select public.billing_status() r')).rows[0].r);
const save = (uid, seconds, origin = null) => P.asUser(uid, async (d) => {
  if (origin) await d.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ origin })]);
  try {
    return (await d.query(`insert into public.transcriptions (title, transcript_text, duration_seconds, segments) values ('t', 'x', $1, '[]') returning id`, [seconds])).rows[0].id;
  } finally { if (origin) await d.query(`select set_config('request.headers', '', false)`); }
});
const settings = (sql) => db.query(`update public.billing_settings set ${sql}`);

// ---- plans and the Free default ----
const plans = (await db.query('select key, monthly_seconds, price_cents, billing_interval from public.billing_plans order by sort_order')).rows;
ok(JSON.stringify(plans.map((p) => [p.key, p.monthly_seconds, p.price_cents])) === JSON.stringify([['free', 3600, 0], ['plus', 72000, 799], ['pro', 180000, 1499]]), 'plans: Free 60 min $0, Plus 20 h $7.99, Pro 50 h $14.99 (same as production)');
const a = await P.createUser('a@example.com');
const s0 = await status(a);
ok(s0.plan === 'free' && s0.monthlySeconds === 3600 && s0.periodKind === 'calendar_month' && !s0.enforced && !s0.meteringStarted, 'new account: Free, calendar-month period, nothing metered or enforced (production state)');
await rejects(P.asAnon((d) => d.query('select public.billing_status()')), /permission denied/, 'anonymous visitors cannot read billing status');

// ---- metering: off records nothing against the allowance; on counts saves from the start time ----
await save(a, 600);
ok(Number((await status(a)).usedSeconds) === 0, 'metering off: a 10-minute save uses nothing');
await new Promise((r) => setTimeout(r, 30));
await settings(`metering_starts_at = now()`);
await new Promise((r) => setTimeout(r, 30));
await save(a, 900);
ok(Number((await status(a)).usedSeconds) === 900, 'metering on: a 15-minute save uses 900 s (earlier saves are never counted)');
const billable = async (dur, segs, text) => Number((await db.query('select private.billable_seconds($1, $2::jsonb, $3) s', [dur, JSON.stringify(segs), text])).rows[0].s);
ok(await billable(10, [{ s: 0, e: 95.5, t: 'a b' }], null) === 95.5, 'billable time: the last line end wins over a smaller reported duration');
ok(await billable(5, [{ s: 0, e: 1, t: Array(400).fill('w').join(' ') }], null) === 100, 'billable time: a 400-word transcript counts at least 100 s (under-reporting is caught)');
ok(await billable(30, [{ s: 0, e: 'nonsense', t: '' }], null) === 30, 'billable time: a malformed value never makes a save fail');
ok(await billable(9e8, [], null) === 360000, 'billable time: capped at 100 hours');

// ---- quota ----
await save(a, 2000); // 900 + 2000 = 2900 of 3600, while not enforced
await settings(`enforce_quota = true`);
await rejects(save(a, 1200), /quota_exceeded/, 'enforced: a save longer than the time left is refused');
const okId = await save(a, 600);
ok(okId && Number((await status(a)).remainingSeconds) === 100, 'enforced: a save that fits is accepted (100 s left)');
await rejects(P.asUser(a, (d) => d.query(`update public.transcriptions set duration_seconds = 9000 where id = $1`, [okId])), /recording_length_locked/, 'a saved recording cannot be made longer afterwards');
await rejects(P.asUser(a, (d) => d.query(`update public.usage set seconds = 0`)), /permission denied|cannot be changed/, 'usage rows cannot be edited');
await rejects(P.asUser(a, (d) => d.query(`insert into public.usage (user_id, transcription_id, seconds, plan, billing_period_start, billing_period_end) values ($1, gen_random_uuid(), 0, 'free', now(), now())`, [a])), /permission denied/, 'usage rows cannot be inserted by users');
await P.asUser(a, (d) => d.query('delete from public.transcriptions'));
ok(Number((await status(a)).usedSeconds) === 3500, 'deleting recordings does not give time back');
await settings(`enforce_quota = false, enforce_origins = '{https://preview.example}'`);
const b = await P.createUser('b@example.com');
await save(b, 3500);
await rejects(save(b, 600, 'https://preview.example'), /quota_exceeded/, 'origin-scoped: enforced for the listed Preview origin');
ok(await save(b, 600, 'https://prod.example'), 'origin-scoped: not enforced anywhere else');
await settings(`enforce_origins = '{}'`);

// ---- upgrade, renewal, downgrade and cancel ----
await new Promise((r) => setTimeout(r, 30));
const day = 86400e3, now = Date.now(); // a real upgrade starts its billing period at the moment of purchase
const iso = (t) => new Date(t).toISOString();
const sub = (over = {}) => ({ p_secret: SECRET, p_customer: 'cus_A', p_meta_user: a, p_subscription: 'sub_1', p_status: 'active', p_plan: 'plus', p_price: 'price_plus', p_livemode: false, p_period_start: iso(now), p_period_end: iso(now + 30 * day), p_cancel_at_period_end: false, p_cancel_at: null, p_canceled_at: null, ...over });
ok((await call('billing_link_customer', { p_secret: SECRET, p_user: a, p_customer: 'cus_A', p_livemode: false })) === 'cus_A', 'link a Stripe customer (server secret)');
await call('billing_apply_subscription', sub());
let s = await status(a);
ok(s.plan === 'plus' && s.monthlySeconds === 72000 && s.periodKind === 'billing', 'upgrade to Plus: 20 h, billing-period based');
ok(Number(s.usedSeconds) === 0, 'Free-month usage before the subscription period does not count against Plus');
await settings(`enforce_quota = true`);
ok(await save(a, 7200), 'Plus: a 2-hour save is accepted');
await call('billing_apply_subscription', sub({ p_plan: 'pro', p_price: 'price_pro' }));
ok((await status(a)).monthlySeconds === 180000 && Number((await status(a)).usedSeconds) === 7200, 'upgrade Plus → Pro mid-period: 50 h, same period, usage kept');
await new Promise((r) => setTimeout(r, 30));
const renewed = Date.now(); // the renewal webhook carries the next period
await call('billing_apply_subscription', sub({ p_plan: 'pro', p_price: 'price_pro', p_period_start: iso(renewed), p_period_end: iso(renewed + 30 * day) }));
ok(Number((await status(a)).usedSeconds) === 0, 'renewal: a new period starts from zero');
await call('billing_apply_subscription', sub({ p_plan: 'pro', p_price: 'price_pro', p_cancel_at_period_end: true }));
s = await status(a);
ok(s.plan === 'pro' && s.cancelAtPeriodEnd === true, 'cancel at period end: Pro stays until the period ends');
await call('billing_apply_subscription', sub({ p_status: 'past_due' }));
s = await status(a);
ok(s.plan === 'plus' && s.paymentProblem === true, 'payment failing (past_due): access kept, problem flagged');
await call('billing_apply_subscription', sub({ p_status: 'unpaid' }));
ok((await status(a)).plan === 'free', 'unpaid: back to Free');
await call('billing_apply_subscription', sub({ p_status: 'canceled', p_canceled_at: iso(now) }));
ok((await status(a)).plan === 'free', 'canceled: Free immediately');

// ---- out-of-order, unknown and foreign events change nothing ----
await call('billing_apply_subscription', sub({ p_subscription: 'sub_2', p_status: 'active' }));
await call('billing_apply_subscription', sub({ p_subscription: 'sub_1', p_status: 'canceled' }));
ok((await status(a)).plan === 'plus', 'a late "canceled" event for an old subscription does not cancel the newer active one');
await call('billing_apply_subscription', sub({ p_subscription: 'sub_2', p_plan: null, p_price: 'price_unknown' }));
ok((await status(a)).plan === 'free', 'an unknown price grants nothing (Free)');
await rejects(call('billing_apply_subscription', sub({ p_customer: 'cus_nobody' })), /unknown_customer/, 'unknown customer refused');
await rejects(call('billing_apply_subscription', sub({ p_meta_user: b })), /user_mismatch/, 'subscription naming another user refused');
await rejects(call('billing_apply_subscription', sub({ p_livemode: true })), /mode_mismatch/, 'a live event for a test customer refused');
await rejects(call('billing_link_customer', { p_secret: SECRET, p_user: b, p_customer: 'cus_A', p_livemode: false }), /another_user/, "another user's customer cannot be linked");
await call('billing_apply_subscription', sub({ p_subscription: 'sub_2', p_status: 'active' }));
await db.query(`update public.billing_settings set stripe_livemode = true`);
ok((await status(a)).plan === 'free', 'a test-mode subscription never grants access once the app runs in live mode');
await db.query(`update public.billing_settings set stripe_livemode = false`);

// ---- webhook idempotency ----
const ev = (id) => call('billing_event_begin', { p_secret: SECRET, p_event_id: id, p_type: 'customer.subscription.updated', p_livemode: false });
ok((await ev('evt_1')) === 'new' && (await ev('evt_1')) === 'duplicate', 'the same Stripe event is processed once');
await call('billing_event_finish', { p_secret: SECRET, p_event_id: 'evt_1', p_result: 'error', p_detail: 'x', p_user: null, p_customer: null, p_subscription: null });
ok((await ev('evt_1')) === 'new', 'an event that failed can be retried');

// ---- the gate ----
await rejects(call('billing_apply_subscription', sub({ p_secret: 'wrong' })), /forbidden/, 'wrong server secret refused');
await rejects(call('billing_event_begin', { p_secret: null, p_event_id: 'e', p_type: 't', p_livemode: false }), /forbidden/, 'missing secret refused');
await rejects(P.asUser(a, (d) => d.query(`select public.billing_apply_subscription($1, 'cus_A', null, 'sub_x', 'active', 'pro', 'p', false, now(), now() + interval '30 days', false, null, null)`, [SECRET])), /permission denied/, 'signed-in users cannot call the server billing functions even with the secret');
await rejects(P.asUser(a, (d) => d.query(`update public.subscriptions set plan = 'pro', status = 'active'`)), /permission denied/, 'users cannot edit their subscription');
ok((await P.asUser(b, (d) => d.query('select count(*)::int n from public.subscriptions'))).rows[0].n === 0, "users cannot see others' subscriptions");
await rejects(P.asUser(a, (d) => d.query('select * from public.billing_events')), /permission denied/, 'users cannot read the event log');

console.log(`\n${pass} checks passed`);
