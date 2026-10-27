// Unlimited accounts (20261027100000_unlimited_accounts.sql), on an isolated Postgres with every migration: accounts
// not on the list get exactly what they got before; an account on the list is Thunder (features, meter) with no
// transcription quota, no per-plan AI limits and no part in the service-wide AI breaker; the list can't be read or
// changed through the API; rollback restores the old behaviour exactly and re-applying works.
//   node qa/sql/unlimited-accounts.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDb } from './pg.mjs';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const rejects = async (p, re, m) => { let err = null; try { await p; } catch (e) { err = e; } ok(err && re.test(`${err.code} ${err.message}`), `${m} (${err ? `${err.code} ${err.message}`.slice(0, 70) : 'no error'})`); };
const MIG = '20261027100000_unlimited_accounts.sql';
const file = (p) => readFileSync(new URL(`../../supabase/${p}`, import.meta.url), 'utf8');

const P = await freshDb({ only: (n) => n !== MIG });
const { db } = P;
const SECRET = 'qa-server-secret';
await db.query(`insert into private.billing_secrets (name, hash) values ('server', sha256(convert_to($1, 'UTF8')))`, [SECRET]);
await db.query(`update public.billing_settings set metering_starts_at = now() - interval '40 days', enforce_quota = true, enforce_ai_limits = true`);
const DAY = 86400e3, now = Date.now(), iso = (d) => new Date(d).toISOString();
const sub = (uid, plan, start, end) => db.query(
  `insert into public.subscriptions (user_id, plan, status, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end, livemode)
   values ($1::uuid, $2, 'active', 'cus_' || left($1::text, 8), 'sub_' || left($1::text, 8), $3, $4, false)`, [uid, plan, start, end]);
const use = (uid, seconds) => db.query(`insert into public.usage (user_id, transcription_id, seconds, plan, billing_period_start, billing_period_end, created_at) values ($1, gen_random_uuid(), $2, 'x', now(), now(), now() - interval '1 hour')`, [uid, seconds]);
const status = (uid) => P.asUser(uid, async (d) => (await d.query('select public.billing_status() r')).rows[0].r);
const reserve = (uid, est = 0) => P.asUser(uid, async (d) => (await d.query('select public.ai_reserve($1, $2, $3) r', ['ask', est, SECRET])).rows[0].r);
const save = (uid, seconds) => P.asUser(uid, (d) => d.query(`insert into public.transcriptions (title, transcript_text, duration_seconds) values ('t', 'x', $1)`, [seconds]));
const ent = async (uid) => (await db.query(`select plan, plan_name, status, monthly_seconds, used_seconds::float8 used, period_kind, has_billing_account from private.entitlement($1)`, [uid])).rows[0];

// accounts: Free, Flash subscriber, and the two that will be put on the list (one Free, one paying for Flash)
const free = await P.createUser('free@example.com'), flash = await P.createUser('flash@example.com');
const u1 = await P.createUser('owner1@example.com'), u2 = await P.createUser('owner2@example.com');
await sub(flash, 'flash', iso(now - 10 * DAY), iso(now + 20 * DAY));
await sub(u2, 'flash', iso(now - 10 * DAY), iso(now + 20 * DAY));
for (const u of [free, flash, u1, u2]) await use(u, 600);
const snap = async (users) => { const out = []; for (const u of users) { const s = await status(u); delete s.unlimited; out.push(await ent(u), s); } return JSON.stringify(out); };
const before = await snap([free, flash, u1, u2]);

// ---------- apply ----------
await db.exec(file(`migrations/${MIG}`));
ok(await snap([free, flash, u1, u2]) === before, 'with the list empty, every plan, meter and billing status is exactly as before');
ok((await status(free)).unlimited === false, 'billing_status says unlimited: false for everyone else');

await db.query(`insert into private.unlimited_accounts (user_id, note) values ($1, 'qa'), ($2, 'qa')`, [u1, u2]);
ok(await snap([free, flash]) === JSON.stringify(JSON.parse(before).slice(0, 4)), 'accounts not on the list are unchanged');

const s1 = await status(u1), s2 = await status(u2);
ok(s1.plan === 'thunder' && s1.planName === 'Thunder' && s1.status === 'active' && s1.unlimited === true, 'a Free account on the list is Thunder');
ok(JSON.stringify(s1.features) === JSON.stringify(['focused_review', 'followup_practice', 'across_ask', 'across_guide']), 'with every Thunder feature');
ok(s1.enforced === false && s1.monthlySeconds === 72000 && s1.usedSeconds == 600, 'the meter shows Thunder\'s allowance and real use; time is never enforced');
ok(s1.hasBillingAccount === false && s1.periodKind === 'calendar_month', 'no billing account appears for it (no Manage Billing)');
ok(s2.plan === 'thunder' && s2.hasBillingAccount === true && s2.periodKind === 'billing', 'a paying account on the list keeps its billing details, with Thunder features');

// ---------- transcription quota ----------
await save(u1, 200000);   // far beyond Thunder's 20 hours
ok(true, 'an account on the list can save a recording longer than any allowance');
ok((await status(u1)).usedSeconds > 72000, 'and its real use is still recorded on the meter');
await rejects(save(free, 5000), /quota_exceeded/, 'a Free account is still refused past its 30 minutes');

// ---------- AI limits ----------
await db.query(`update public.ai_plan_limits set actions_per_hour = 3 where plan in ('free', 'thunder')`);
for (let i = 0; i < 3; i++) await reserve(free);
ok((await reserve(free)).allowed === false, 'Free still hits its hourly limit');
let all = true; for (let i = 0; i < 10; i++) all = all && (await reserve(u1)).allowed; ok(all, 'an account on the list has no hourly limit');
await db.query(`update public.ai_plan_limits set monthly_budget_microusd = 1000 where plan = 'thunder'`);
ok((await reserve(u1, 200000)).allowed === true, 'nor a monthly AI budget');
// the daily breaker: the unlimited account's spend doesn't count, and it isn't stopped by it
await db.query(`update public.billing_settings set ai_daily_budget_microusd = 500000`);
await db.query(`insert into public.ai_usage (user_id, feature, status, estimate_microusd, cost_microusd) values ($1, 'x', 'done', 0, 5000000)`, [u1]);
ok((await reserve(flash)).allowed === true, 'heavy use by an unlimited account never pauses the AI for customers');
await db.query(`insert into public.ai_usage (user_id, feature, status, estimate_microusd, cost_microusd) values ($1, 'x', 'done', 0, 600000)`, [flash]);
ok((await reserve(flash)).reason === 'paused', 'customers\' own spend still trips the breaker');
ok((await reserve(u1)).allowed === true, 'and an unlimited account keeps working when it does');
await db.query(`insert into public.ai_usage (user_id, feature, created_at) select $1, 'x', now() from generate_series(1, 1000)`, [u2]);
ok((await reserve(u2)).allowed === false, 'the 1,000-an-hour flood ceiling still applies to everyone');

// ---------- the list is private ----------
await rejects(P.asUser(u1, (d) => d.query('select * from private.unlimited_accounts')), /permission denied/, 'an account can\'t read the list');
await rejects(P.asUser(free, (d) => d.query(`insert into private.unlimited_accounts (user_id) values ($1)`, [free])), /permission denied/, 'nor add itself to it');
await rejects(P.asUser(free, (d) => d.query(`select private.is_unlimited($1)`, [free])), /permission denied/, 'nor call the check directly');

// ---------- rollback, then re-apply ----------
await db.exec(file(`proposed/rollback/${MIG.replace('.sql', '.down.sql')}`));
ok((await status(u1)).plan === 'free' && (await status(u1)).unlimited === undefined, 'rollback: accounts that were on the list are back on their real plan');
await rejects(save(u1, 600), /quota_exceeded/, 'rollback: and their quota applies again');
ok((await db.query(`select to_regclass('private.unlimited_accounts') r`)).rows[0].r === null, 'rollback: the list is gone');
await db.exec(file(`migrations/${MIG}`));
ok((await status(free)).unlimited === false, 'the migration applies again after a rollback');

console.log(`\n${pass} checks passed`);
