// scripts/stripe-permissions.mjs: how Stripe's answers are read, with fake clients (no network, no Stripe account).
// Regressions: 2026-10-19 a runtime key with Coupons = None was reported as able to write coupons (POST
// /v1/coupons/<fake id> answered 404, read as "allowed"); 2026-10-20 the same key was refused because GET /v1/products
// answered 200 although Products = None (catalog read is granted with other permissions; it can't change anything).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RUNTIME, SETUP, EXCESS, probe, checkExcess, classify, classifyWrite } from '../scripts/stripe-permissions.mjs';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

// stripe-node style errors
const E = {
  forbidden: () => Object.assign(new Error('The provided key \'rk_live_abc123\' does not have the required permissions for this endpoint. Having the \'rak_coupon_write\' permission would allow this request to continue.'), { statusCode: 403, type: 'StripePermissionError' }),
  noSuch: (what) => Object.assign(new Error(`No such ${what}: 'sparkscribepermprobe'`), { statusCode: 404, code: 'resource_missing', type: 'StripeInvalidRequestError' }),
  invalid: () => Object.assign(new Error('Must provide percent_off or amount_off.'), { statusCode: 400, code: 'parameter_missing', type: 'StripeInvalidRequestError' }),
  server: () => Object.assign(new Error('An unknown error occurred'), { statusCode: 500, type: 'StripeAPIError' }),
};
// a fake client: `answers` maps "resource.method" to a function returning a value or throwing; every call is recorded
function fakeStripe(answers) {
  const calls = [];
  const handler = (path) => new Proxy(() => {}, {
    get: (_, k) => handler(path ? `${path}.${String(k)}` : String(k)),
    apply: async (_, __, args) => {
      calls.push({ path, args });
      const a = answers[path];
      if (!a) throw new Error(`unexpected call ${path}`);
      return a(...args);
    },
  });
  return { client: handler(''), calls };
}
const throws = (e) => () => { throw e(); };
const empty = () => ({ object: 'list', data: [] });

// a runtime key configured as in the dashboard: Products/Prices/Coupons/Webhook Endpoints = None
const noneKey = (over = {}) => fakeStripe({
  'products.create': throws(E.forbidden), 'products.update': throws(E.forbidden), 'products.list': throws(E.forbidden),
  'prices.create': throws(E.forbidden), 'prices.update': throws(E.forbidden), 'prices.list': throws(E.forbidden),
  'coupons.create': throws(E.forbidden), 'coupons.list': throws(E.forbidden), 'coupons.update': throws(() => E.noSuch('coupon')),
  'webhookEndpoints.create': throws(E.forbidden), 'webhookEndpoints.update': throws(E.forbidden), 'webhookEndpoints.list': throws(E.forbidden),
  ...over,
});
const byLabel = (rows, l) => rows.find((r) => r.label === l);

// ---- 1. the reported cases (2026-10-19 and 2026-10-20)
{
  // 2026-10-20, as observed live: Products = None, yet GET /v1/products answers 200 (read granted with another permission)
  // while POST /v1/products/<id> answers 403
  const { client, calls } = noneKey({ 'products.list': empty });
  const rows = await checkExcess(client);
  ok(rows.every((r) => r.result === 'none'), `Products readable through another permission but not writable: passes (${rows.map((r) => `${r.label}:${r.result}`).join(', ')})`);
  ok(byLabel(rows, 'Products').read.result === 'readable' && /HTTP 200/.test(byLabel(rows, 'Products').read.evidence), '…and the read is reported (informational), with its evidence');
  ok(byLabel(rows, 'Products').writes.every((w) => /HTTP 403/.test(w.evidence)), '…both write probes show 403');
  // 2026-10-19: the coupon lookup answers "No such coupon" before the permission check
  ok(!calls.some((c) => c.path === 'coupons.update') && byLabel(rows, 'Coupons').result === 'none', 'Coupons = None passes; no update of a made-up coupon id');
  ok(classify(E.noSuch('coupon')) === 'ok' && classifyWrite([{ create: false, err: E.noSuch('coupon') }]) === 'inconclusive', 'a 404 alone is never read as "can change"');
  ok(calls.filter((c) => c.path.endsWith('.create')).every((c) => !('name' in c.args[0]) && !('currency' in c.args[0]) && !('amount_off' in c.args[0]) && !('percent_off' in c.args[0]) && !('url' in c.args[0])), 'every create probe lacks its required field: nothing can be created');
}

// ---- 2. strictness kept: a genuinely over-privileged runtime key still fails, and names the permission
{
  const { client } = noneKey({ 'products.create': throws(E.invalid), 'products.update': throws(() => E.noSuch('product')), 'products.list': empty });
  const rows = await checkExcess(client);
  ok(byLabel(rows, 'Products').result === 'excess' && byLabel(rows, 'Products').permission === 'product_write' && rows.filter((r) => r.result === 'excess').length === 1, 'Products writable → excess, naming product_write');
  const { client: c2 } = fakeStripe(Object.fromEntries(['products', 'prices', 'coupons', 'webhookEndpoints'].flatMap((r) => [[`${r}.create`, throws(E.invalid)], [`${r}.update`, throws(() => E.noSuch('x'))], [`${r}.list`, empty]])));
  ok((await checkExcess(c2)).every((r) => r.result === 'excess'), 'an unrestricted key → excess on all four');
  const { client: c3 } = noneKey({ 'coupons.create': throws(E.server) });
  ok(byLabel(await checkExcess(c3), 'Coupons').result === 'inconclusive', 'an unexpected answer (500) is "can\'t tell", never a pass');
  const { client: c4 } = noneKey({ 'prices.create': throws(E.invalid) });
  ok(byLabel(await checkExcess(c4), 'Prices').result === 'inconclusive', 'contradictory answers (create 400, update 403) are "can\'t tell", never a pass');
  ok(classifyWrite([{ create: true, err: E.forbidden() }]) === 'none' && classifyWrite([{ create: true, err: E.invalid() }]) === 'excess', '403 = cannot change; 400 on an invalid create = can change');
}

// ---- 3. required permissions
{
  ok(classify(E.forbidden()) === 'missing' && classify(E.noSuch('customer')) === 'ok' && classify(E.invalid()) === 'ok' && classify(E.server()) === 'error' && classify(null) === 'ok', 'required: 403 missing; 404 / 400 allowed; 500 error');
  const coupon = SETUP.find((p) => p.label === 'Coupons');
  const { client, calls } = fakeStripe({ 'coupons.create': throws(E.invalid) });
  const [row] = await probe(client, [coupon]);
  const args = calls[0].args[0];
  ok(row.result === 'ok' && calls[0].path === 'coupons.create' && !('amount_off' in args) && !('percent_off' in args), 'setup Coupons: an invalid create (no amount: nothing can be created); 400 = allowed');
  const { client: c2 } = fakeStripe({ 'coupons.create': throws(E.forbidden) });
  ok((await probe(c2, [coupon]))[0].result === 'missing', 'setup Coupons: 403 = missing');
  ok(!SETUP.concat(RUNTIME).some((p) => p.label === 'Coupons' && /\/coupons\/sparkscribe/.test(p.endpoint)), 'no probe updates a coupon by a made-up id any more');
  ok(EXCESS.map((p) => `${p.label}:${p.permission}`).join() === 'Products:product_write,Prices:plan_write,Coupons:coupon_write,Webhook Endpoints:webhook_write' && EXCESS.every((p) => p.writes.some((w) => w.create)), 'the runtime key must not be able to change Products, Prices, Coupons, Webhook Endpoints (permission names from the Stripe reference)');
  ok(!RUNTIME.some((p) => EXCESS.some((x) => x.label === p.label)), 'nothing the runtime key needs is in the excess list');
}

// ---- 4. the live setup checks the RUNTIME key (not the setup key) for excess, and fails on excess or "can't tell"
{
  const src = readFileSync(new URL('../scripts/stripe-live-setup.mjs', import.meta.url), 'utf8');
  ok(/const runtime = new Stripe\(runtimeKey\)/.test(src) && /checkExcess\(runtime\)/.test(src) && !/checkExcess\(stripe\)/.test(src), 'stripe-live-setup runs the excess check with the runtime key');
  ok(/if \(!DRY && extra\.length\) fail/.test(src) && /if \(!DRY && unclear\.length\) fail/.test(src), 'live mode stops on excess and on an unclear answer');
  ok(/runtimeKey === setupKey\) fail/.test(src) && /rk_live_/.test(src), 'the runtime key must be a restricted key different from the setup key');
}
console.log(`\n${pass} checks passed`);
