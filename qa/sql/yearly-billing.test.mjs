// Yearly billing (20261017300000_yearly_billing.sql), on an isolated Postgres with every migration: monthly plans and
// Free are computed exactly as before; a yearly subscription gets the plan's allowance every billing month (windows
// anchored on its start, month ends handled), the quota check and the usage ledger use those windows, billing_status
// says the interval and renewal, the yearly prices are in the catalogue; rollback restores the old behaviour exactly
// and re-applying works.   node qa/sql/yearly-billing.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDb } from './pg.mjs';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const rejects = async (p, re, m) => { let err = null; try { await p; } catch (e) { err = e; } ok(err && re.test(`${err.code} ${err.message}`), `${m} (${err ? `${err.code} ${err.message}`.slice(0, 70) : 'no error'})`); };
const MIG = '20261017300000_yearly_billing.sql';
const file = (p) => readFileSync(new URL(`../../supabase/${p}`, import.meta.url), 'utf8');

// the database as it was just before this migration (later ones replace the same functions)
const P = await freshDb({ only: (n) => n < MIG });
const { db } = P;
const iso = (d) => new Date(d).toISOString();
const DAY = 86400e3, now = Date.now();
await db.query(`update public.billing_settings set metering_starts_at = '2025-01-01T00:00:00Z'`);
const sub = (uid, plan, start, end, status = 'active') => db.query(
  `insert into public.subscriptions (user_id, plan, status, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end, livemode)
   values ($1::uuid, $2, $3, 'cus_' || left($1::text, 8), 'sub_' || left($1::text, 8), $4, $5, false)
   on conflict (user_id) do update set plan = excluded.plan, status = excluded.status, stripe_customer_id = excluded.stripe_customer_id,
     stripe_subscription_id = excluded.stripe_subscription_id, current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end, livemode = false`,
  [uid, plan, status, start, end]);
const use = (uid, at, seconds) => db.query(`insert into public.usage (user_id, transcription_id, seconds, plan, billing_period_start, billing_period_end, created_at) values ($1, gen_random_uuid(), $2, 'x', $3, $3, $3)`, [uid, seconds, at]);
const ent = async (uid, at) => (await db.query(`select plan, monthly_seconds, used_seconds::float8 used, period_start, period_end, period_kind from private.entitlement($1, $2)`, [uid, at])).rows[0];
const status = (uid) => P.asUser(uid, async (d) => (await d.query('select public.billing_status() r')).rows[0].r);

// accounts as they could exist: Free, monthly Flash (current), monthly Bolt ending soon, a past-due Thunder
const f = await P.createUser('free@example.com'), m = await P.createUser('monthly@example.com'), e = await P.createUser('ending@example.com'), pd = await P.createUser('pastdue@example.com');
await sub(m, 'flash', iso(now - 10 * DAY), iso(now + 20 * DAY));
await sub(e, 'bolt', iso(now - 29 * DAY), iso(now + DAY));
await sub(pd, 'thunder', iso(now - 31 * DAY), iso(now - DAY), 'past_due');
for (const u of [f, m, e, pd]) { await use(u, iso(now - 5 * DAY), 600); await use(u, iso(now - 45 * DAY), 900); }
const probes = [now, now - 3 * DAY, now + 5 * DAY, now + 25 * DAY].map(iso);
const snapshot = async () => { const out = []; for (const u of [f, m, e, pd]) for (const at of probes) out.push(await ent(u, at)); return JSON.stringify(out); };
// sequential (one connection, one identity at a time); a lapsed period's end is "now + 1 s", so it is left out
const statusSnap = async () => { const out = []; for (const u of [f, m, e, pd]) { const s = await status(u); delete s.billingInterval; delete s.renewsAt; if (s.status === 'past_due') delete s.periodEnd; out.push(Object.fromEntries(Object.entries(s).sort(([x], [y]) => x.localeCompare(y)))); } return JSON.stringify(out); };
const before = await snapshot(), beforeStatus = await statusSnap();

await db.exec(file(`migrations/${MIG}`));
ok(await snapshot() === before, 'Free and monthly subscriptions: every allowance period and usage total is identical after the migration');
const afterStatus = await statusSnap();
ok(afterStatus === beforeStatus, 'billing_status is unchanged for them apart from the two new fields');

// ---- the yearly prices ----
const yp = (await db.query(`select key, price_cents, yearly_price_cents from public.billing_plans where tier is not null order by tier`)).rows;
ok(JSON.stringify(yp.map((p) => [p.key, p.price_cents, p.yearly_price_cents])) === JSON.stringify([['free', 0, null], ['flash', 599, 5900], ['bolt', 999, 9900], ['thunder', 1499, 14900]]), 'yearly prices: Flash $59, Bolt $99, Thunder $149 (monthly prices unchanged)');
await rejects(db.query(`update public.billing_plans set yearly_price_cents = 100 where key = 'free'`), /23514|check/, 'a plan without a monthly price can’t have a yearly one');
ok((await P.asAnon(async (d) => (await d.query(`select yearly_price_cents from public.billing_plans where key = 'bolt'`)).rows[0])).yearly_price_cents === 9900, 'the yearly price is public (the pricing page reads it)');

// ---- a yearly subscription: monthly windows from Jan 31 ----
const y = await P.createUser('yearly@example.com');
await sub(y, 'bolt', '2026-01-31T15:00:00Z', '2027-01-31T15:00:00Z');
const w = async (at) => { const r = await ent(y, at); return [iso(r.period_start).slice(0, 10), iso(r.period_end).slice(0, 10), r.period_kind, r.monthly_seconds]; };
ok(JSON.stringify(await w('2026-02-15T00:00:00Z')) === JSON.stringify(['2026-01-31', '2026-02-28', 'billing_month', 32400]), 'Feb 15: window Jan 31 → Feb 28, with Bolt’s full 9 hours');
ok(JSON.stringify(await w('2026-03-01T00:00:00Z')) === JSON.stringify(['2026-02-28', '2026-03-31', 'billing_month', 32400]), 'Mar 1: a new window Feb 28 → Mar 31');
ok(JSON.stringify(await w('2026-03-31T15:00:00Z')) === JSON.stringify(['2026-03-31', '2026-04-30', 'billing_month', 32400]), 'exactly at the monthly boundary: the next window starts');
ok(JSON.stringify(await w('2026-03-31T14:59:59Z')) === JSON.stringify(['2026-02-28', '2026-03-31', 'billing_month', 32400]), 'one second before it: still the previous window');
ok(JSON.stringify(await w('2026-12-31T16:00:00Z')) === JSON.stringify(['2026-12-31', '2027-01-31', 'billing_month', 32400]), 'the 12th window ends with the year');
const months = new Set();
for (let d = Date.parse('2026-01-31T15:00:00Z'); d < Date.parse('2027-01-31T15:00:00Z'); d += 3 * DAY) months.add((await w(iso(d)))[0]);
ok(months.size === 12, `12 monthly allowances in the year (${months.size})`);
const late = await ent(y, '2027-02-01T12:00:00Z');
ok(late.plan === 'bolt' && iso(late.period_start).startsWith('2027-01-31') && Date.parse(iso(late.period_end)) > Date.parse('2027-02-01T12:00:00Z'), 'renewal webhook late (within the 2-day grace): still Bolt, counting from the last boundary');
ok((await ent(y, '2027-02-05T00:00:00Z')).plan === 'free', 'no renewal after the grace: Free, like a monthly plan');

// usage counts per window: the allowance renews every month
await use(y, '2026-02-10T00:00:00Z', 30000);
await use(y, '2026-03-05T00:00:00Z', 1800);
ok((await ent(y, '2026-02-20T00:00:00Z')).used === 30000, 'February: 30000 s used of 32400');
ok((await ent(y, '2026-03-10T00:00:00Z')).used === 1800, 'March: February’s use doesn’t count; only March’s 1800 s');

// ---- now: the quota check and the ledger use the current monthly window ----
const yn = await P.createUser('yearly-now@example.com');
const start = now - 40 * DAY;
await sub(yn, 'flash', iso(start), iso(start + 365 * DAY));
const sNow = await status(yn);
ok(sNow.billingInterval === 'year' && sNow.periodKind === 'billing_month' && sNow.monthlySeconds === 10800, 'billing_status: yearly Flash, 3 hours a month');
ok(Date.parse(sNow.renewsAt) === start + 365 * DAY && Date.parse(sNow.periodEnd) < Date.parse(sNow.renewsAt), 'renewsAt is the yearly renewal; periodEnd is when this month’s allowance renews');
const mNow = await status(m);
ok(mNow.billingInterval === 'month' && Date.parse(mNow.renewsAt) === Date.parse(mNow.periodEnd), 'monthly: billingInterval month, renewsAt = periodEnd');
const fNow = await status(f);
ok(fNow.billingInterval === null && fNow.renewsAt === null, 'Free: no interval, no renewal');
// last month's heavy use doesn't block this month
await use(yn, iso(Date.parse(sNow.periodStart) - 2 * DAY), 10800);
await use(yn, iso(Date.parse(sNow.periodStart) + 60e3), 10000);
await db.query(`update public.billing_settings set enforce_quota = true`);
const save = (uid, seconds) => P.asUser(uid, async (d) => (await d.query(`insert into public.transcriptions (title, transcript_text, duration_seconds, segments) values ('t', 'x', $1, '[]') returning id`, [seconds])).rows[0].id);
await rejects(save(yn, 1200), /quota|limit|P0001|allowance/i, 'this month: 800 s left, a 20-minute recording is refused');
const tid = await save(yn, 600);
const led = (await db.query(`select billing_period_start, billing_period_end, plan from public.usage where transcription_id = $1`, [tid])).rows[0];
ok(led && iso(led.billing_period_start) === iso(sNow.periodStart) && iso(led.billing_period_end) === iso(sNow.periodEnd) && led.plan === 'flash', 'a 10-minute one fits; the ledger records this month’s window');
await db.query(`update public.billing_settings set enforce_quota = false`);

// ---- recovery ----
const counts = async () => JSON.stringify((await db.query(`select (select count(*) from public.usage)::int u, (select count(*) from public.subscriptions)::int s, (select sum(seconds) from public.usage)::float8 t`)).rows[0]);
const countsBefore = await counts();
await db.exec(file('proposed/rollback/20261017300000_yearly_billing.down.sql'));
ok(await snapshot() === before, 'after rollback: Free and monthly results identical to before');
ok((await db.query(`select count(*)::int n from information_schema.columns where table_name = 'billing_plans' and column_name = 'yearly_price_cents'`)).rows[0].n === 0, 'rollback drops the yearly price column');
ok((await ent(y, '2026-03-10T00:00:00Z')).period_kind === 'billing', 'rollback restores the old (whole-period) behaviour');
ok(await counts() === countsBefore, `usage and subscriptions untouched by rollback ${countsBefore}`);
await db.exec(file(`migrations/${MIG}`));
ok((await ent(y, '2026-03-10T00:00:00Z')).period_kind === 'billing_month' && await snapshot() === before, 're-applying after a rollback works');
console.log(`\n${pass} checks passed`);
