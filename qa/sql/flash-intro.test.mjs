// The Flash introductory offer's eligibility records (20261017100000_flash_intro.sql), on an isolated Postgres with every
// migration: who is eligible, per Stripe mode; only the server can record a redemption; nothing a user can write changes
// eligibility; records go with the account; rollback and re-apply.   node qa/sql/flash-intro.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDb } from './pg.mjs';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const rejects = async (p, re, m) => { let err = null; try { await p; } catch (e) { err = e; } ok(err && re.test(`${err.code} ${err.message}`), `${m} (${err ? `${err.code} ${err.message}`.slice(0, 60) : 'no error'})`); };
const file = (p) => readFileSync(new URL(`../../supabase/${p}`, import.meta.url), 'utf8');

const P = await freshDb({ proposed: false });
const { db } = P;
const SECRET = 'qa-billing-secret';
await db.query(`insert into private.billing_secrets (name, hash) values ('server', sha256(convert_to($1, 'UTF8')))`, [SECRET]);
const call = (fn, args) => P.asAnon(async (d) => { const k = Object.keys(args); return (await d.query(`select public.${fn}(${k.map((x, i) => `${x} => $${i + 1}`).join(', ')}) r`, k.map((x) => args[x]))).rows[0].r; });
const status = (uid) => P.asUser(uid, async (d) => (await d.query('select public.billing_status() r')).rows[0].r);
const a = await P.createUser('a@example.com'), b = await P.createUser('b@example.com');

ok((await status(a)).introEligible === true, 'a new account is eligible');
await call('billing_link_customer', { p_secret: SECRET, p_user: a, p_customer: 'cus_a', p_livemode: false });
const iso = (t) => new Date(t).toISOString(), day = 86400e3;
const apply = (o) => call('billing_apply_subscription', { p_secret: SECRET, p_customer: 'cus_a', p_meta_user: a, p_subscription: 'sub_a', p_status: 'active', p_plan: 'flash', p_price: 'price_flash', p_livemode: false, p_period_start: iso(Date.now()), p_period_end: iso(Date.now() + 30 * day), p_cancel_at_period_end: false, p_cancel_at: null, p_canceled_at: null, ...o });
await apply({ p_status: 'incomplete' });
ok((await status(a)).introEligible === true, 'a first payment that never went through (incomplete) keeps the offer');
await apply({ p_status: 'active' });
ok((await status(a)).introEligible === false, 'once a paid plan is active, the account has paid history and is no longer eligible');
await apply({ p_status: 'canceled', p_canceled_at: iso(Date.now()) });
ok((await status(a)).plan === 'free' && (await status(a)).introEligible === false, 'canceled and back on Free: still not eligible (no repeat $1 month)');

// redemption: server only, idempotent, per mode
ok((await call('billing_promo_redeem', { p_secret: SECRET, p_user: b, p_promo: 'flash_intro', p_livemode: false, p_session: 'cs_1', p_subscription: 'sub_b' })) === 'redeemed', 'the webhook records a redemption');
ok((await call('billing_promo_redeem', { p_secret: SECRET, p_user: b, p_promo: 'flash_intro', p_livemode: false, p_session: 'cs_2', p_subscription: 'sub_b2' })) === 'already', 'a second redemption for the same account → "already" (one per account)');
ok((await status(b)).introEligible === false, 'redeemed → not eligible');
await rejects(call('billing_promo_redeem', { p_secret: 'wrong', p_user: a, p_promo: 'flash_intro', p_livemode: false, p_session: 'x', p_subscription: 'y' }), /42501|forbidden/, 'without the server secret: refused');
await rejects(P.asUser(b, (d) => d.query(`select public.billing_promo_redeem($1, $2, 'flash_intro', false, 'x', 'y')`, [SECRET, b])), /42501|permission denied/, 'signed-in users cannot call it, even with the secret');
await rejects(P.asUser(b, (d) => d.query(`delete from private.billing_promotions`)), /42501|permission denied/, 'users cannot clear their redemption (private schema)');
await rejects(P.asUser(a, (d) => d.query(`delete from private.billing_paid_history`)), /42501|permission denied/, '…nor their paid history');
await rejects(P.asUser(a, (d) => d.query(`select private.intro_eligible($1, false)`, [a])), /42501|permission denied/, 'the eligibility function itself is not callable by users');

// test mode never affects live mode
await db.query(`update public.billing_settings set stripe_livemode = true`);
ok((await status(a)).introEligible === true && (await status(b)).introEligible === true, 'test-mode history and redemptions don’t count once the site runs in live mode');
await db.query(`update public.billing_settings set stripe_livemode = false`);

// the account goes, its records go
await db.query('delete from auth.users where id = $1', [b]);
ok((await db.query(`select count(*)::int n from private.billing_promotions where user_id = $1`, [b])).rows[0].n === 0, 'account deletion removes its records (ids and timestamps only)');

// rollback and re-apply
await db.exec(file('proposed/rollback/20261017100000_flash_intro.down.sql'));
const gone = (await db.query(`select to_regclass('private.billing_promotions') t, to_regprocedure('public.billing_promo_redeem(text,uuid,text,boolean,text,text)') f`)).rows[0];
const st = await status(a);
ok(gone.t === null && gone.f === null && !('introEligible' in st) && Array.isArray(st.features), 'rollback removes the offer’s records and restores the previous billing_status');
await apply({ p_status: 'active' });
ok((await status(a)).plan === 'flash', 'billing still syncs after the rollback');
await db.exec(file('migrations/20261017100000_flash_intro.sql'));
ok((await status(a)).introEligible === false, 're-applied: the active subscription counts as history again (backstop)');
console.log(`\n${pass} checks passed`);
