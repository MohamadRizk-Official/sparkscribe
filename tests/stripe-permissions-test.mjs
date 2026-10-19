// scripts/stripe-permissions.mjs: how Stripe's answers are read, with fake clients (no network, no Stripe account).
// Regression for 2026-10-19: a runtime key with Coupons = None was reported as able to write coupons, because the old
// excess probe (POST /v1/coupons/<fake id>) got "No such coupon" (404) and 404 was read as "allowed".
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RUNTIME, SETUP, EXCESS, probe, checkExcess, classify, classifyExcess } from '../scripts/stripe-permissions.mjs';

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

// ---- 1. the reported case: Coupons = None on the runtime key
{
  const { client, calls } = fakeStripe({
    'products.list': throws(E.forbidden), 'prices.list': throws(E.forbidden), 'webhookEndpoints.list': throws(E.forbidden),
    'coupons.list': throws(E.forbidden),
    // what the old probe saw: the coupon lookup answers before the permission check
    'coupons.update': throws(() => E.noSuch('coupon')),
  });
  const rows = await checkExcess(client);
  ok(rows.every((r) => r.result === 'none'), `runtime key with Products/Prices/Coupons/Webhooks = None passes (${rows.map((r) => `${r.label}:${r.result}`).join(', ')})`);
  ok(!calls.some((c) => c.path === 'coupons.update') && calls.every((c) => c.path.endsWith('.list')), 'the excess check only makes list reads (no update of a fake coupon)');
  ok(rows.find((r) => r.label === 'Coupons').evidence === 'HTTP 403 (StripePermissionError)', 'the evidence (status, type) is reported');
  ok(classify(E.noSuch('coupon')) === 'ok' && classifyExcess(E.noSuch('coupon')) === 'inconclusive', 'a 404 is never read as "has the permission" by the excess check');
}

// ---- 2. strictness kept: a genuinely over-privileged runtime key still fails
{
  const { client } = fakeStripe({ 'products.list': throws(E.forbidden), 'prices.list': throws(E.forbidden), 'webhookEndpoints.list': throws(E.forbidden), 'coupons.list': empty });
  const rows = await checkExcess(client);
  ok(rows.find((r) => r.label === 'Coupons').result === 'excess' && rows.filter((r) => r.result === 'excess').length === 1, 'Coupons readable (Read or Write) → reported as excess');
  const { client: c2 } = fakeStripe({ 'products.list': empty, 'prices.list': empty, 'webhookEndpoints.list': empty, 'coupons.list': empty });
  ok((await checkExcess(c2)).every((r) => r.result === 'excess'), 'an unrestricted key → excess on all four');
  const { client: c3 } = fakeStripe({ 'products.list': throws(E.forbidden), 'prices.list': throws(E.forbidden), 'webhookEndpoints.list': throws(E.forbidden), 'coupons.list': throws(E.server) });
  ok((await checkExcess(c3)).find((r) => r.label === 'Coupons').result === 'inconclusive', 'an unexpected answer (500) is "can\'t tell", never a pass');
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
  ok(EXCESS.map((p) => p.label).join() === 'Products,Prices,Coupons,Webhook Endpoints' && EXCESS.every((p) => /^GET /.test(p.endpoint)), 'the runtime key must have None on Products, Prices, Coupons, Webhook Endpoints (list reads)');
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
