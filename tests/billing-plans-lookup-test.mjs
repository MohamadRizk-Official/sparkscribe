// Plan catalogue and price -> plan lookup (server/billing/config.js: loadPlans, planForPrice, planAndIntervalForPrice, clearPlansCache).
// The database is a stand-in: global fetch answers the PostgREST request the Supabase client makes, so nothing leaves this machine.
import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'http://db.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
for (const k of ['STRIPE_FLASH_PRICE_ID', 'STRIPE_BOLT_PRICE_ID', 'STRIPE_THUNDER_PRICE_ID', 'STRIPE_FLASH_YEARLY_PRICE_ID', 'STRIPE_BOLT_YEARLY_PRICE_ID', 'STRIPE_THUNDER_YEARLY_PRICE_ID']) delete process.env[k];
process.env.STRIPE_FLASH_PRICE_ID = 'price_FlashM';
process.env.STRIPE_FLASH_YEARLY_PRICE_ID = 'price_FlashY';
process.env.STRIPE_BOLT_PRICE_ID = 'price_BoltM';
const B = await import(new URL('../server/billing/config.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

const PLANS = [
  { key: 'free', tier: 0, billing_interval: null },
  { key: 'flash', tier: 1, billing_interval: 'month' },
  { key: 'bolt', tier: 2, billing_interval: 'month' },
];
let calls = 0;
let urls = [];
let reply = () => ({ status: 200, body: PLANS });
globalThis.fetch = async (url) => {
  calls++; urls.push(String(url));
  const { status, body } = reply();
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
};

B.clearPlansCache();
ok(B.PLAN_COLUMNS.includes('yearly_price_cents') && B.PLAN_COLUMNS.includes('billing_interval') && B.PLAN_COLUMNS.includes('tier'), 'the plan columns include the yearly price, the interval and the tier');

const plans = await B.loadPlans();
ok(plans.length === 3 && calls === 1, 'loadPlans reads the catalogue from the database');
ok(urls[0].includes('/billing_plans') && urls[0].includes('tier=not.is.null') && urls[0].includes('order=tier'), 'it asks only for plans that have a tier, ordered by tier');
await B.loadPlans();
ok(calls === 1, 'a second call within a minute is served from the cache');
B.clearPlansCache();
await B.loadPlans();
ok(calls === 2, 'clearPlansCache makes the next call ask the database again');

ok((await B.planForPrice('price_FlashM')) === 'flash', 'a monthly price id maps to its plan');
ok((await B.planForPrice('price_FlashY')) === 'flash', 'a yearly price id maps to the same plan');
const both = await B.planAndIntervalForPrice('price_FlashY');
ok(both.plan === 'flash' && both.interval === 'year', 'planAndIntervalForPrice also says which interval the price is for');
ok((await B.planAndIntervalForPrice('price_BoltM')).interval === 'month', 'a monthly price reports the "month" interval');
ok((await B.planForPrice('price_Unknown')) === null, 'an unknown price grants nothing (null)');
ok((await B.planForPrice('')) === null && (await B.planForPrice(undefined)) === null, 'an empty or missing price id is null');
ok((await B.planForPrice('price_ThunderM')) === null, 'a price whose plan has no configured id is null');

// the Free plan has no billing interval, so even a matching env var is never looked up for it
process.env.STRIPE_FREE_PRICE_ID = 'price_FreeM';
ok((await B.planForPrice('price_FreeM')) === null, 'the Free plan (no billing interval) never maps from a price');

// an older database without the yearly column
B.clearPlansCache();
urls = [];
let first = true;
reply = () => {
  if (first) { first = false; return { status: 400, body: { code: '42703', message: 'column does not exist' } }; }
  return { status: 200, body: PLANS };
};
const fallback = await B.loadPlans();
ok(fallback.length === 3 && urls.length === 2, 'a missing yearly column triggers one retry');
ok(/select=[^&]*yearly_price_cents/.test(decodeURIComponent(urls[0])) && !/yearly_price_cents/.test(decodeURIComponent(urls[1])), 'the retry leaves the yearly price out');

// failures
B.clearPlansCache();
reply = () => ({ status: 500, body: { message: 'boom' } });
let err;
try { await B.loadPlans(); } catch (e) { err = e; }
ok(err instanceof B.BillingError && err.status === 503 && err.code === 'plans_unavailable', 'a database error becomes a 503 plans_unavailable');
reply = () => ({ status: 200, body: [] });
err = null;
try { await B.loadPlans(); } catch (e) { err = e; }
ok(err?.code === 'plans_unavailable', 'an empty catalogue is also plans_unavailable');
err = null;
try { await B.planForPrice('price_FlashM'); } catch (e) { err = e; }
ok(err?.code === 'plans_unavailable', 'the lookup passes that error on instead of guessing');

console.log(`${pass} checks passed`);
