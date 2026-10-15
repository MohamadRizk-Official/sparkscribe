// SQL-level tests of the AI usage limits (supabase/migrations/*_ai_usage_limits.sql) on an isolated Postgres
// with every production migration applied. No network, no production data.   node qa/sql/ai-limits.test.mjs
import assert from 'node:assert/strict';
import { freshDb } from './pg.mjs';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const rejects = async (p, re, m) => { let err = null; try { await p; } catch (e) { err = e; } ok(err && re.test(err.message), `${m} (${err ? err.message.slice(0, 60) : 'no error'})`); };

const P = await freshDb({ proposed: true });
ok(P.applied.some((n) => n.includes('ai_usage_limits')), 'proposed migration applies on top of all production migrations');
const { db } = P;
const SECRET = 'qa-server-secret';
await db.query(`insert into private.billing_secrets (name, hash) values ('server', sha256(convert_to($1, 'UTF8')))`, [SECRET]);
await db.query(`update public.billing_settings set metering_starts_at = now() - interval '1 day'`);
const a = await P.createUser('free@example.com'), b = await P.createUser('other@example.com'), plus = await P.createUser('plus@example.com');
// the server always passes its secret; a direct call from a browser can't (tested below)
const reserve = (uid, feature = 'ask', est = 0, secret = SECRET) => P.asUser(uid, async (d) => (await d.query('select public.ai_reserve($1, $2, $3) r', [feature, est, secret])).rows[0].r);
const count = async (uid) => (await db.query('select count(*)::int n from public.ai_usage where user_id = $1', [uid])).rows[0].n;

// ---- off by default: nothing is refused, but every action is recorded ----
const r0 = await reserve(a);
ok(r0.allowed === true && r0.enforced === false && r0.plan === 'free', 'switched off by default: allowed, not enforced, plan resolved (free)');
{ // even switched off, direct calls can't flood the ledger: a 1,000/hour ceiling no real use reaches
  const flood = await P.createUser('flood@example.com');
  await db.query(`insert into public.ai_usage (user_id, feature) select $1, 'x' from generate_series(1, 1000)`, [flood]);
  const f = await reserve(flood);
  ok(f.allowed === false && f.limit === 1000, 'while off, the 1,000-per-hour safety ceiling still applies');
}
for (let i = 0; i < 30; i++) await reserve(a);
ok((await count(a)) === 31, 'while off, actions are still recorded in the ledger (31)');

// ---- on: hourly limit for Free (20) ----
await db.query(`update public.billing_settings set enforce_ai_limits = true`);
const refused = await reserve(a);
ok(refused.allowed === false && refused.reason === 'hourly' && refused.limit === 20 && refused.retry_after_s > 0 && refused.retry_after_s <= 3600, `enforced: Free user over 20/hour is refused with a retry time (${refused.retry_after_s} s)`);
ok((await count(a)) === 31, 'a refused reservation adds no row');
ok((await reserve(b)).allowed === true, 'another user is unaffected');

// ---- the ledger can't be changed or read across users ----
await rejects(P.asUser(a, (d) => d.query('delete from public.ai_usage')), /permission denied/, 'user cannot delete ledger rows');
await rejects(P.asUser(a, (d) => d.query(`insert into public.ai_usage (feature) values ('x')`)), /permission denied/, 'user cannot insert ledger rows directly');
await rejects(P.asUser(a, (d) => d.query(`update public.ai_usage set created_at = now() - interval '2 days'`)), /permission denied/, 'user cannot back-date ledger rows');
ok((await P.asUser(b, (d) => d.query('select count(*)::int n from public.ai_usage'))).rows[0].n === 1, 'a user sees only their own ledger rows');
await rejects(P.asAnon((d) => d.query(`select public.ai_reserve('ask', 0)`)), /permission denied/, 'anonymous visitors cannot reserve');

// ---- deleting results does not reset the count (the old row-count limiter's hole) ----
await P.asUser(a, (d) => d.query(`insert into public.transcriptions (title, transcript_text, duration_seconds) values ('t', 'x', 10)`));
await P.asUser(a, (d) => d.query('delete from public.transcriptions'));
ok((await reserve(a)).allowed === false, 'deleting recordings/results does not free AI quota');

// ---- monthly budget (estimates count until settled) ----
const c = await P.createUser('budget@example.com');
ok((await reserve(c, 'tool:study_guide', 100000)).allowed === true, 'Free: $0.10 estimate fits the $0.15 budget');
const over = await reserve(c, 'tool:study_guide', 60000);
ok(over.allowed === false && over.reason === 'monthly', 'Free: next $0.06 estimate exceeds the monthly budget → refused (monthly)');

// ---- settling needs the server secret ----
const id = (await reserve(b, 'ask', 500)).id;
await rejects(P.asUser(b, (d) => d.query('select public.ai_settle($1, $2, true, 10, 10, 1)', ['wrong', id])), /forbidden/, 'settle with a wrong secret is refused');
await rejects(P.asUser(b, (d) => d.query('select public.ai_settle(null, $1, true, 10, 10, 1)', [id])), /forbidden/, 'settle without a secret is refused');
await P.asUser(b, (d) => d.query('select public.ai_settle($1, $2, true, 2900, 300, 440)', [SECRET, id]));
const row = (await db.query('select status, cost_microusd, input_tokens from public.ai_usage where id = $1', [id])).rows[0];
ok(row.status === 'done' && row.cost_microusd === 440 && row.input_tokens === 2900, 'server settle records real tokens and cost');
await P.asUser(a, (d) => d.query('select public.ai_settle($1, $2, true, 1, 1, 0)', [SECRET, id]));
ok((await db.query('select cost_microusd from public.ai_usage where id = $1', [id])).rows[0].cost_microusd === 440, "a user can't settle someone else's row");
const fid = (await reserve(b, 'ask', 500)).id;
await P.asUser(b, (d) => d.query('select public.ai_settle($1, $2, false, 0, 0, 999)', [SECRET, fid]));
const frow = (await db.query('select status, cost_microusd from public.ai_usage where id = $1', [fid])).rows[0];
ok(frow.status === 'failed' && frow.cost_microusd === 999, "a failed call keeps its real cost on record (service total, accounting)");
{ // …but isn't charged to the user's monthly allowance; an abandoned call (never settled) counts at its estimate
  const f = await P.createUser('fairness@example.com');
  const x = (await reserve(f, 'tool:quiz', 100)).id;
  await P.asUser(f, (d) => d.query('select public.ai_settle($1, $2, false, 9000, 9000, 140000)', [SECRET, x]));
  ok((await reserve(f, 'tool:quiz', 100000)).allowed === true, "a failed $0.14 call doesn't use the user's $0.15 allowance");
  const g = await P.createUser('abandoned@example.com');
  await reserve(g, 'tool:study_guide', 120000); // the function was killed before settling: stays 'reserved'
  const r2 = await reserve(g, 'tool:quiz', 40000);
  ok(r2.allowed === false && r2.reason === 'monthly', 'an abandoned call counts at its estimate (no free retries by timing out)');
}

// ---- plans: an active Plus subscription gets the Plus limits ----
await db.query(`insert into public.subscriptions (user_id, plan, status, livemode, current_period_start, current_period_end)
  values ($1, 'plus', 'active', false, now() - interval '3 days', now() + interval '27 days')
  on conflict (user_id) do update set plan = excluded.plan, status = excluded.status, livemode = false,
    current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end`, [plus]);
const p1 = await reserve(plus);
ok(p1.allowed && p1.plan === 'plus' && p1.hour_limit === 120 && p1.budget_microusd === 1500000, 'Plus subscriber: 120/hour, $1.50 budget');
for (let i = 0; i < 25; i++) await reserve(plus);
ok((await reserve(plus)).allowed === true, 'Plus is not stopped at the Free limit (27 actions)');
await db.query(`update public.subscriptions set status = 'canceled' where user_id = $1`, [plus]);
const afterCancel = await reserve(plus);
ok(afterCancel.allowed === false && afterCancel.plan === 'free', 'canceled subscription falls back to Free limits immediately');
for (const [status, label] of [['trialing', 'trial'], ['past_due', 'payment retrying']]) {
  const u = await P.createUser(`${status}@example.com`);
  await db.query(`insert into public.subscriptions (user_id, plan, status, livemode, current_period_start, current_period_end) values ($1, 'pro', $2, false, now() - interval '1 day', now() + interval '29 days')`, [u, status]);
  const r = await reserve(u);
  ok(r.plan === 'pro' && r.hour_limit === 240 && r.budget_microusd === 3500000, `Pro (${label}): 240/hour, $3.50 budget`);
}

// ---- concurrency: many simultaneous reservations never exceed the limit ----
const d = await P.createUser('burst@example.com');
const results = await Promise.all(Array.from({ length: 40 }, () => reserve(d)));
ok(results.filter((r) => r.allowed).length === 20 && (await count(d)) === 20, '40 simultaneous requests: exactly 20 allowed, 20 rows (no overshoot)');

// ---- origin-scoped enforcement (Preview only), like the quota ----
await db.query(`update public.billing_settings set enforce_ai_limits = false, enforce_origins = '{https://preview.example}'`);
const asOrigin = (uid, origin) => P.asUser(uid, async (q) => { await q.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ origin })]); try { return (await q.query(`select public.ai_reserve('ask', 0) r`)).rows[0].r; } finally { await q.query(`select set_config('request.headers', '', false)`); } });
ok((await asOrigin(a, 'https://prod.example')).allowed === true, 'enforcement off for other origins (production unaffected)');
ok((await asOrigin(a, 'https://preview.example')).allowed === false, 'enforced only for the listed Preview origin');

// the server names its deployment in x-sparkscribe-origin (server/http.js deploymentOrigin), which a browser can't set
const asServerFrom = (uid, origin) => P.asUser(uid, async (q) => { await q.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-sparkscribe-origin': origin })]); try { return (await q.query(`select public.ai_reserve('ask', 0) r`)).rows[0].r; } finally { await q.query(`select set_config('request.headers', '', false)`); } });
ok((await asServerFrom(a, 'https://preview.example')).allowed === false && (await asServerFrom(a, 'https://prod.example')).allowed === true, "the server's own deployment header selects origin-scoped enforcement");

// ---- a plan without its own limits row gets the Free limits, and missing limits refuse when enforced ----
await db.query(`update public.billing_settings set enforce_ai_limits = true, enforce_origins = '{}'`);
await db.query(`insert into public.billing_plans (key, name, tagline, price_cents, monthly_seconds, sort_order) values ('team', 'Team', 'x', 2999, 360000, 9)`);
const team = await P.createUser('team@example.com');
await db.query(`insert into public.subscriptions (user_id, plan, status, livemode, current_period_start, current_period_end) values ($1, 'team', 'active', false, now() - interval '1 day', now() + interval '29 days')`, [team]);
const t1 = await reserve(team);
ok(t1.allowed && t1.plan === 'team' && t1.hour_limit === 20, 'a plan with no limits row is held to the Free limits (not unlimited)');
await db.query(`delete from public.ai_plan_limits where plan = 'free'`);
const t2 = await reserve(team);
ok(t2.allowed === false && t2.reason === 'unavailable', 'enforced with no limits defined at all → refused, not unmetered');
await db.query(`update public.billing_settings set enforce_ai_limits = false`);
ok((await reserve(team)).allowed === true, '…and with enforcement off it still only records');

// ---- service-wide breaker: total spend in 24 h across all users ----
await db.query(`update public.billing_settings set ai_daily_budget_microusd = (select sum(coalesce(cost_microusd, estimate_microusd))::int + 1000 from public.ai_usage where created_at > now() - interval '24 hours')`);
const h = await P.createUser('breaker@example.com');
ok((await reserve(h, 'ask', 500)).allowed === true, 'under the daily service budget: allowed');
const tripped = await reserve(h, 'ask', 900);
ok(tripped.allowed === false && tripped.reason === 'paused', 'over the daily service budget: every user is paused (even with per-user limits off)');
await db.query(`update public.billing_settings set ai_daily_budget_microusd = null`);
ok((await reserve(h, 'ask', 900)).allowed === true, 'breaker switched off (null): allowed again');
await db.query(`update public.billing_settings set ai_daily_budget_microusd = 5000000`);
{ // a signed-in user calling ai_reserve directly (no server secret) can't pause the AI for everyone
  const attacker = await P.createUser('attacker@example.com'), victim = await P.createUser('victim@example.com');
  const direct = await reserve(attacker, 'x', 4999999, null);
  const row = (await db.query('select estimate_microusd from public.ai_usage where id = $1', [direct.id])).rows[0];
  ok(direct.allowed === true && row.estimate_microusd === 0, 'a direct call without the server secret is recorded with a zero estimate');
  ok((await reserve(victim, 'ask', 900)).allowed === true, '…so it cannot trip the service-wide breaker for other users');
  const capped = await reserve(attacker, 'x', 99999999);
  ok((await db.query('select estimate_microusd from public.ai_usage where id = $1', [capped.id])).rows[0].estimate_microusd === 250000, 'a trusted estimate is capped at $0.25 per action');
}

// ---- account deletion removes the ledger ----
await db.query('delete from auth.users where id = $1', [b]);
ok((await count(b)) === 0, 'deleting the account deletes its AI ledger rows (cascade)');

console.log(`\n${pass} checks passed`);
