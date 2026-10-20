// A key Stripe rejects (401) is reported as a key problem, never as missing permissions; Stripe's masked key echo is
// redacted; a setup key with the Production key's profile is recognised as "keys swapped". Regression for 2026-10-20:
// after rolling both keys, the first prompt got the Production key and the second a key Stripe rejected (401), and the
// script answered "Add these permissions". Fake clients, no network, no real key.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SETUP, RUNTIME, probe, report, classify, clean, checkAuth, looksLikeRuntimeKey } from '../scripts/stripe-permissions.mjs';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const tail = 'WXYZ'; // what Stripe's echo shows of the key: must never be printed
const E = {
  auth: (expired) => Object.assign(new Error(`${expired ? 'Expired' : 'Invalid'} API Key provided: rk_live_${'*'.repeat(94)}${tail}`), { statusCode: 401, type: 'StripeAuthenticationError' }),
  forbidden: () => Object.assign(new Error('does not have the required permissions'), { statusCode: 403, type: 'StripePermissionError', code: 'more_permissions_required' }),
  noSuch: () => Object.assign(new Error('No such object'), { statusCode: 404, code: 'resource_missing', type: 'StripeInvalidRequestError' }),
  invalid: () => Object.assign(new Error('Missing required param'), { statusCode: 400, code: 'parameter_missing', type: 'StripeInvalidRequestError' }),
};
// a fake client where every call answers with `f(path)`
const client = (f) => { const h = (path) => new Proxy(() => {}, { get: (_, k) => h(path ? `${path}.${String(k)}` : String(k)), apply: async () => { const r = f(path); if (r instanceof Error) throw r; return r; } }); return h(''); };

// ---- 401 is a key problem
ok(classify(E.auth()) === 'auth' && classify(E.forbidden()) === 'missing', '401 → "auth" (key rejected); 403 → "missing" (permission)');
const rejected = await probe(client(() => E.auth()), RUNTIME);
const text = report(rejected);
ok(rejected.every((r) => r.result === 'auth') && /KEY REJECTED \(401/.test(text) && !/MISSING/.test(text), 'a rejected key is reported as KEY REJECTED, never as missing permissions');
ok(!text.includes(tail) && !clean(E.auth().message).includes(tail) && clean(E.auth().message) === 'Invalid API Key provided: <key>', "Stripe's masked echo of the key (it shows the last 4 characters) is fully redacted");
ok(clean('key sk_live_abc123 and rk_test_****9f2a and pk_live_x') === 'key <key> and <key> and <key>', 'any key form is redacted');

// ---- the read-only acceptance check
ok((await checkAuth(client(() => E.auth()))).ok === false, 'checkAuth: 401 → not accepted');
ok((await checkAuth(client(() => E.auth(true)))).expired === true, 'checkAuth: an expired (rolled) key is named as expired');
ok((await checkAuth(client(() => E.forbidden()))).ok === true && (await checkAuth(client(() => ({ data: [] })))).ok === true, 'checkAuth: 403 or 200 → accepted (permissions are checked later)');

// ---- keys entered in the wrong order (the 2026-10-20 run: the first key had exactly these answers)
const prodProfile = (path) => (/^(products|prices|coupons|webhookEndpoints)\./.test(path) ? E.forbidden() : path === 'billingPortal.configurations.update' || path === 'checkout.sessions.expire' ? E.noSuch() : E.noSuch());
const sp = await probe(client(prodProfile), SETUP);
ok(looksLikeRuntimeKey(sp), 'a "setup" key that can\'t create products/prices/coupons/webhooks but can do Checkout → recognised as the Production key');
const goodSetup = await probe(client((p) => (p === 'coupons.create' ? E.invalid() : E.noSuch())), SETUP);
ok(!looksLikeRuntimeKey(goodSetup) && goodSetup.every((r) => r.result === 'ok'), 'a real setup key is not mistaken for it');

// ---- the setup script: acceptance first, the right message for each case
{
  const src = readFileSync(new URL('../scripts/stripe-live-setup.mjs', import.meta.url), 'utf8');
  const auth = src.indexOf('await checkAuth(stripe)'), vercel = src.indexOf("run(bin, ['env', 'ls', 'production'])"), probes = src.indexOf('await probe(stripe, SETUP)');
  ok(auth > 0 && auth < vercel && auth < probes, 'both keys are checked with a read-only request before the Vercel check and before any permission probe');
  ok(/const authFix = [^\n]*This is not a permissions problem/.test(src) && !/const authFix = [^\n]*Edit key/.test(src), 'the 401 message says to re-copy the key, not to change permissions');
  const swap = src.indexOf('looksLikeRuntimeKey(sp)'), perms = src.indexOf('Add these permissions');
  ok(swap > 0 && swap < perms, 'a swapped pair is reported before any "add permissions" advice');
  ok(/RUNTIME prompt received: \$\{kind\(runtimeKey\)\}/.test(src) && /const kind = \(k\) => `\$\{k\.length\} characters/.test(src), 'what each prompt received is shown as length and type only');
  ok(/--check-keys/.test(src) && /if \(CHECK_ONLY\) \{[^\n]*process\.exit\(0\)/.test(src), '--check-keys verifies the keys and stops before anything is changed');
  ok(!/e\.message\.replace\(\/\(sk\|rk\)/.test(src) && /clean\(e\.message\)/.test(src), 'error messages from Stripe go through the full redaction');
}
console.log(`\n${pass} checks passed`);
