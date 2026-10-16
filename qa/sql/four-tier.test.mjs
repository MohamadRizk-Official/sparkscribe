// Master Phase 3: the four-tier migration (20261016100000_four_tier.sql) and the release cutover, on an isolated Postgres
// with every production migration (no network, no production data).
//   * applied on top of a database that already has accounts, recordings, usage and study work: nothing is lost;
//   * the catalogue, capabilities per plan and per subscription state, AI limits (and their fail-closed fallback);
//   * saved Thunder history: only the server can write it, only the owner can read or delete it.
//   node qa/sql/four-tier.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDb } from './pg.mjs';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const rejects = async (p, re, m) => { let err = null; try { await p; } catch (e) { err = e; } ok(err && re.test(`${err.code} ${err.message}`), `${m} (${err ? `${err.code} ${err.message}`.slice(0, 70) : 'no error'})`); };
const file = (p) => readFileSync(new URL(`../../supabase/${p}`, import.meta.url), 'utf8');

// ---- a database as production is today: every migration before this one, with some content ----
const P = await freshDb({ only: (n) => n < '20261016' });
const { db } = P;
const SECRET = 'qa-billing-secret';
await db.query(`insert into private.billing_secrets (name, hash) values ('server', sha256(convert_to($1, 'UTF8')))`, [SECRET]);
const a = await P.createUser('a@example.com'), b = await P.createUser('b@example.com'), c = await P.createUser('c@example.com');
const seg = JSON.stringify([{ s: 0, e: 40, sp: 'Speaker 1', t: 'Osmosis moves water across a membrane.' }]);
const rec = async (uid, title) => (await P.asUser(uid, (d) => d.query(`insert into public.transcriptions (title, transcript_text, duration_seconds, segments) values ($1, 'x', 40, $2) returning id`, [title, seg]))).rows[0].id;
const a1 = await rec(a, 'Lecture 1'), a2 = await rec(a, 'Lecture 2'), a3 = await rec(a, 'Lecture 3');
const b1 = await rec(b, 'B only');
await db.query(`insert into public.transcription_artifacts (user_id, transcription_id, kind, settings_key, status, content, source_version, progress) values ($2, $1, 'quiz', 'k', 'ready', '{"questions":[]}', 1, '{"last_score":3}')`, [a1, a]);
const snapshot = async () => (await db.query(`select
  (select count(*) from auth.users)::int users, (select count(*) from public.transcriptions)::int recs,
  (select count(*) from public.usage)::int usage, (select coalesce(sum(seconds), 0)::numeric from public.usage) secs,
  (select count(*) from public.transcription_artifacts)::int arts, (select count(*) from public.subscriptions)::int subs,
  (select string_agg(id::text || title || content_version, ',' order by id) from public.transcriptions) recsig,
  (select string_agg(progress::text, ',') from public.transcription_artifacts) progress`)).rows[0];
const before = await snapshot();

// ---- apply stage 1 ----
await db.exec(file('migrations/20261016100000_four_tier.sql'));
const after = await snapshot();
ok(JSON.stringify(before) === JSON.stringify(after), `accounts, recordings, usage, study progress and subscriptions unchanged (${after.users} users, ${after.recs} recordings, ${after.usage} usage rows)`);

const plans = (await db.query('select key, tier, price_cents, monthly_seconds, features, intro_price_cents, intro_months, active, is_default from public.billing_plans order by tier nulls last, key')).rows;
const by = Object.fromEntries(plans.map((p) => [p.key, p]));
ok(by.free.monthly_seconds === 1800 && by.flash.monthly_seconds === 10800 && by.bolt.monthly_seconds === 32400 && by.thunder.monthly_seconds === 72000, 'allowances: Free 1,800 s, Flash 10,800 s, Bolt 32,400 s, Thunder 72,000 s');
ok(by.bolt.monthly_seconds === 3 * by.flash.monthly_seconds, 'Bolt is exactly three times Flash');
ok(by.free.price_cents === 0 && by.flash.price_cents === 599 && by.bolt.price_cents === 999 && by.thunder.price_cents === 1499, 'prices: $0, $5.99, $9.99, $14.99');
ok(by.flash.intro_price_cents === 100 && by.flash.intro_months === 1 && by.bolt.intro_price_cents == null && by.thunder.intro_price_cents == null, 'Flash: $1 for the first month (display data); no other plan has an introductory price');
ok(by.free.is_default && by.free.tier === 0 && by.flash.tier === 1 && by.bolt.tier === 2 && by.thunder.tier === 3, 'tiers 0–3, Free is the default plan');
ok(!by.flash.active && !by.bolt.active && !by.thunder.active && by.plus.active && by.pro.active && by.plus.tier == null, 'stage 1: the new paid plans are not yet public to older builds (active = false); Plus/Pro unchanged');
ok(by.free.features.length === 0 && by.flash.features.length === 0 && JSON.stringify(by.bolt.features) === '["focused_review","followup_practice"]'
  && JSON.stringify(by.thunder.features) === '["focused_review","followup_practice","across_ask","across_guide"]', 'capabilities: Bolt = Focused Review + follow-up practice; Thunder = Bolt + Ask across + combined guide');
await rejects(db.query(`update public.billing_plans set features = '{}' where key = 'thunder'`), /23514|higher plan/, 'a higher plan can never lose a capability a lower plan has');
await rejects(db.query(`update public.billing_plans set features = '{unlimited_everything}' where key = 'bolt'`), /23514|check/, 'unknown capability names are refused');
await rejects(db.query(`update public.billing_plans set intro_price_cents = 700 where key = 'flash'`), /23514|check/, 'an introductory price must be below the regular price');

// ---- capabilities per subscription state ----
await db.query(`update public.billing_settings set metering_starts_at = now() - interval '1 day'`);
const status = (uid) => P.asUser(uid, async (d) => (await d.query('select public.billing_status() r')).rows[0].r);
const call = (fn, args) => P.asAnon(async (d) => { const k = Object.keys(args); return (await d.query(`select public.${fn}(${k.map((x, i) => `${x} => $${i + 1}`).join(', ')}) r`, k.map((x) => args[x]))).rows[0].r; });
await call('billing_link_customer', { p_secret: SECRET, p_user: c, p_customer: 'cus_c', p_livemode: false });
const day = 86400e3, iso = (t) => new Date(t).toISOString();
const sub = (o = {}) => call('billing_apply_subscription', { p_secret: SECRET, p_customer: 'cus_c', p_meta_user: c, p_subscription: 'sub_c', p_status: 'active', p_plan: 'thunder', p_price: 'price_thunder', p_livemode: false, p_period_start: iso(Date.now() - day), p_period_end: iso(Date.now() + 29 * day), p_cancel_at_period_end: false, p_cancel_at: null, p_canceled_at: null, ...o });
let s = await status(a);
ok(s.plan === 'free' && s.monthlySeconds === 1800 && s.tier === 0 && Array.isArray(s.features) && s.features.length === 0, 'a Free account: 30 minutes, no premium capability');
const caps = async () => (await status(c)).features.join(',');
const cases = [
  ['flash', 'active', {}, ''], ['bolt', 'active', {}, 'focused_review,followup_practice'], ['thunder', 'active', {}, 'focused_review,followup_practice,across_ask,across_guide'],
  ['thunder', 'trialing', {}, 'focused_review,followup_practice,across_ask,across_guide'],
  ['thunder', 'past_due', {}, 'focused_review,followup_practice,across_ask,across_guide'],  // Stripe still retrying: access kept, warning shown
  ['thunder', 'active', { p_cancel_at_period_end: true }, 'focused_review,followup_practice,across_ask,across_guide'], // canceled, period not over
  ['thunder', 'unpaid', {}, ''], ['thunder', 'canceled', {}, ''], ['thunder', 'incomplete', {}, ''], ['thunder', 'incomplete_expired', {}, ''], ['thunder', 'paused', {}, ''],
  ['thunder', 'active', { p_period_start: iso(Date.now() - 40 * day), p_period_end: iso(Date.now() - 3 * day) }, ''], // period ended 3 days ago with no renewal
  ['bolt', 'active', { p_plan: null, p_price: 'price_unknown' }, ''], // a price the server doesn't know grants nothing
];
for (const [plan, st, extra, want] of cases) {
  await sub({ p_plan: plan, p_price: `price_${plan}`, p_status: st, ...extra });
  const got = await caps();
  ok(got === want, `${plan} / ${st}${Object.keys(extra).length ? ` ${JSON.stringify(Object.keys(extra))}` : ''} → [${got || 'none'}]`);
}
await sub({ p_plan: 'thunder', p_status: 'active' });
s = await status(c);
ok(s.plan === 'thunder' && s.monthlySeconds === 72000, 'Thunder: 20 hours a period');
await db.query(`update public.billing_settings set stripe_livemode = true`);
ok((await caps()) === '', 'a test-mode Thunder subscription grants nothing once the site runs in live mode');
await db.query(`update public.billing_settings set stripe_livemode = false`);

// ---- AI limits ----
const lim = Object.fromEntries((await db.query('select plan, actions_per_hour, monthly_budget_microusd from public.ai_plan_limits')).rows.map((r) => [r.plan, r]));
ok(lim.flash.actions_per_hour === 60 && lim.bolt.actions_per_hour === 120 && lim.thunder.actions_per_hour === 240, 'AI actions per hour: Flash 60, Bolt 120, Thunder 240');
ok(lim.free.monthly_budget_microusd === 150000 && lim.flash.monthly_budget_microusd === 750000 && lim.bolt.monthly_budget_microusd === 1500000 && lim.thunder.monthly_budget_microusd === 3000000, 'AI budgets a period: Free $0.15, Flash $0.75, Bolt $1.50, Thunder $3.00');
await db.query(`update public.billing_settings set enforce_ai_limits = true`);
const reserve = (uid) => P.asUser(uid, async (d) => (await d.query(`select public.ai_reserve('qa', 0, null) r`)).rows[0].r);
ok((await reserve(c)).hour_limit === 240, 'Thunder subscriber: reserved under the Thunder limits');
await db.query(`delete from public.ai_plan_limits where plan = 'thunder'`);
const fallback = await reserve(c);
ok(fallback.allowed && fallback.hour_limit === 20 && fallback.budget_microusd === 150000, 'a plan whose limits row is missing gets the Free limits, never unlimited');
await db.query(`insert into public.ai_plan_limits values ('thunder', 240, 3000000)`);
await db.query(`update public.billing_settings set enforce_ai_limits = false`);

// ---- saved Thunder history ----
const save = (uid, o = {}) => P.asUser(uid, async (d) => (await d.query(`select public.across_save($1, $2, $3, $4::uuid[], $5, $6::jsonb, $7::jsonb) r`,
  [o.secret ?? SECRET, o.request ?? crypto.randomUUID(), o.kind ?? 'ask', o.ids ?? [a1, a2], o.question ?? 'What changed?', JSON.stringify(o.content ?? { answer: 'In {{R1}} … [R1:0]', refs: [] }),
    JSON.stringify(o.sources ?? (o.ids ?? [a1, a2]).map((id, i) => ({ id, label: `R${i + 1}`, title: 't', version: 1 })))])).rows[0].r);
const r1 = await save(a);
ok(r1.saved && r1.id, 'the server (with its secret) saves an answer for the signed-in user');
const req = crypto.randomUUID();
const d1 = await save(a, { request: req }), d2 = await save(a, { request: req });
ok(d1.id === d2.id && d2.duplicate === true, 'a retried save (same request id) is stored once');
await rejects(save(a, { secret: 'wrong' }), /42501|forbidden/, 'without the server secret: refused (a user cannot store forged answers)');
await rejects(save(a, { ids: [a1, b1] }), /22023|unknown recording/, "an answer naming another account's recording is refused");
await rejects(save(a, { ids: [a1] }), /22023|bad selection/, 'fewer than two recordings: refused');
await rejects(save(a, { sources: [{ id: b1, label: 'R1' }, { id: a2, label: 'R2' }] }), /22023|bad sources/, "a source snapshot pointing at another account's recording is refused");
await rejects(P.asUser(a, (d) => d.query(`insert into public.across_items (user_id, request_id, kind, set_key, recording_ids, question, content, sources) values ($1, gen_random_uuid(), 'ask', 'x', $2::uuid[], 'q', '{}', '[]')`, [a, [a1, a2]])), /42501|permission denied/, 'users cannot insert history rows directly');
await rejects(P.asUser(a, (d) => d.query(`update public.across_items set content = '{"answer":"edited"}'`)), /42501|permission denied/, 'users cannot change saved answers');
const g = await save(a, { kind: 'guide', question: 'ignored for guides', ids: [a1, a2, a3], content: { overview: 'x', themes: [] } });
ok(g.saved, 'a combined study guide is saved too (no question)');
const mine = (await P.asUser(a, (d) => d.query('select id, set_key, recording_ids, question from public.across_items order by created_at'))).rows;
ok(mine.length === 3 && mine[0].set_key === [a1, a2].sort().join(',') && mine.at(-1).question === null, 'the owner reads their history, grouped by selection (sorted ids)');
ok((await P.asUser(b, (d) => d.query('select count(*)::int n from public.across_items'))).rows[0].n === 0, "another account sees none of it");
ok((await P.asUser(b, (d) => d.query('select count(*)::int n from public.across_items where id = $1', [r1.id]))).rows[0].n === 0, '…not even by guessing an item id');
await rejects(P.asAnon((d) => d.query('select count(*) from public.across_items')), /42501|permission denied/, 'signed out: refused');
ok((await P.asUser(b, (d) => d.query('delete from public.across_items where id = $1 returning id', [r1.id]))).rows.length === 0, "another account can't delete it");
ok((await P.asUser(a, (d) => d.query('delete from public.across_items where id = $1 returning id', [r1.id]))).rows.length === 1, 'the owner can delete an item');
await P.asUser(a, (d) => d.query('delete from public.transcriptions where id = $1', [a3]));
ok((await P.asUser(a, (d) => d.query('select count(*)::int n from public.across_items where $1 = any (recording_ids)', [a3]))).rows[0].n === 1, 'deleting a recording keeps the history that cited it (shown as unavailable, never recreated)');
await rejects(save(a, { content: { answer: Array.from({ length: 9000 }, () => Math.random().toString(36).slice(2)).join(' ') } }), /23514|check/, 'an oversized answer (over 64 KB) is refused');
// the 500-item cap: refused, never pruned silently
await db.query(`insert into public.across_items (user_id, request_id, kind, set_key, recording_ids, question, content, sources)
  select $1, gen_random_uuid(), 'ask', 'k', array[$2::uuid, $3::uuid], 'q', '{}', '[]' from generate_series(1, 500 - (select count(*) from public.across_items where user_id = $1))`, [a, a1, a2]);
const full = await save(a);
ok(full.saved === false && full.reason === 'full' && (await db.query('select count(*)::int n from public.across_items where user_id = $1', [a])).rows[0].n === 500, 'at 500 items a new save is refused with a reason; nothing is deleted');
await db.query('delete from auth.users where id = $1', [a]);
ok((await db.query('select count(*)::int n from public.across_items')).rows[0].n === 0, 'account deletion removes the account’s saved history');

// ---- stage 2 (release cutover) ----
await db.exec(file('proposed/20261016110000_four_tier_cutover.sql'));
const pub = (await P.asAnon((d) => d.query('select key from public.billing_plans where active order by tier'))).rows.map((r) => r.key).join(',');
ok(pub === 'free,flash,bolt,thunder', `cutover: the public lineup is ${pub}; Plus and Pro retired but kept`);

// ---- rollback ----
await db.query(`delete from public.subscriptions`);
const recsBefore = (await db.query('select count(*)::int n from public.transcriptions')).rows[0].n;
await db.exec(file('proposed/rollback/20261016100000_four_tier.down.sql'));
const rb = (await db.query(`select (select string_agg(key || ':' || monthly_seconds, ',' order by sort_order) from public.billing_plans where active) plans, to_regclass('public.across_items') hist`)).rows[0];
ok(rb.plans === 'free:3600,plus:72000,pro:180000' && rb.hist === null, `rollback restores the previous catalogue (${rb.plans})`);
ok((await db.query('select count(*)::int n from public.transcriptions')).rows[0].n === recsBefore && recsBefore > 0, 'rollback leaves recordings alone');
await db.exec(file('migrations/20261016100000_four_tier.sql'));
ok((await db.query(`select count(*)::int n from public.billing_plans where tier is not null`)).rows[0].n === 4, 're-applying after a rollback works');

console.log(`\n${pass} checks passed`);
