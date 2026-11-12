// Billing gates and helpers (server/billing/config.js): paymentsEnabled, portalAllowed, checkoutAllowedFor,
// automaticTax, priceIdFor, introCouponFor, billingScope, appOrigin, mode detection, BillingError.
import assert from 'node:assert/strict';
const B = await import(new URL('../server/billing/config.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const throwsCode = (fn) => { try { fn(); return null; } catch (e) { return e; } };

const TEST = 'sk_test_abc';
const LIVE = 'sk_live_abc';

// ---- paymentsEnabled: key + BILLING_PAYMENTS_ENABLED (+ approval for live) ----
ok(B.paymentsEnabled({}) === false, 'no key: payments are off');
ok(B.paymentsEnabled({ STRIPE_SECRET_KEY: TEST }) === false, 'a test key alone does not enable payments');
ok(B.paymentsEnabled({ STRIPE_SECRET_KEY: TEST, BILLING_PAYMENTS_ENABLED: '1' }) === true, 'test key + flag enables payments');
ok(B.paymentsEnabled({ STRIPE_SECRET_KEY: TEST, BILLING_PAYMENTS_ENABLED: 'true' }) === false, 'the flag must be exactly "1"');
ok(B.paymentsEnabled({ STRIPE_SECRET_KEY: 'pk_test_abc', BILLING_PAYMENTS_ENABLED: '1' }) === false, 'a publishable key is not a secret key');
ok(B.paymentsEnabled({ STRIPE_SECRET_KEY: LIVE, BILLING_PAYMENTS_ENABLED: '1' }) === false, 'a live key needs explicit approval too');
ok(B.paymentsEnabled({ STRIPE_SECRET_KEY: LIVE, BILLING_PAYMENTS_ENABLED: '1', BILLING_LIVE_APPROVED: '1' }) === true, 'live key + flag + approval enables payments');
ok(B.paymentsEnabled({ STRIPE_SECRET_KEY: 'rk_live_abc', BILLING_PAYMENTS_ENABLED: '1' }) === false, 'restricted live keys are treated as live');

// ---- portalAllowed: open whenever configured, live still needs approval ----
ok(B.portalAllowed({}) === false, 'portal: no key means closed');
ok(B.portalAllowed({ STRIPE_SECRET_KEY: TEST }) === true, 'portal: stays open in test mode even with payments off');
ok(B.portalAllowed({ STRIPE_SECRET_KEY: LIVE }) === false, 'portal: live mode needs approval');
ok(B.portalAllowed({ STRIPE_SECRET_KEY: LIVE, BILLING_LIVE_APPROVED: '1' }) === true, 'portal: live mode with approval is open');

// ---- automaticTax ----
ok(B.automaticTax({}) === false && B.automaticTax({ STRIPE_AUTOMATIC_TAX: '1' }) === true && B.automaticTax({ STRIPE_AUTOMATIC_TAX: '0' }) === false, 'automatic tax is off unless set to "1"');

// ---- checkoutAllowedFor: pilot allowlist ----
ok(B.checkoutAllowedFor(null, {}) === true, 'no allowlist: everyone may check out');
const env = { BILLING_CHECKOUT_ALLOWLIST: ' Me@Example.com , user-1 ' };
ok(B.checkoutAllowedFor({ email: 'me@example.com' }, env) === true, 'an allowlisted email matches case-insensitively');
ok(B.checkoutAllowedFor({ id: 'USER-1', email: 'x@y.z' }, env) === true, 'an allowlisted account id matches');
ok(B.checkoutAllowedFor({ email: 'other@example.com', id: 'u2' }, env) === false, 'anyone else is refused');
ok(B.checkoutAllowedFor(null, env) === false, 'no user with an allowlist set is refused');
ok(B.checkoutAllowedFor({ email: 'a@b.c' }, { BILLING_CHECKOUT_ALLOWLIST: ' , ' }) === true, 'an allowlist of only blanks counts as unset');

// ---- BillingError ----
const be = new B.BillingError('nope');
ok(be instanceof Error && be.status === 400 && be.code === 'bad_request' && be.extra === null, 'BillingError defaults to 400 bad_request');
const be2 = new B.BillingError('x', { status: 503, code: 'c', extra: { a: 1 } });
ok(be2.status === 503 && be2.code === 'c' && be2.extra.a === 1, 'BillingError carries status, code and extra');

// ---- mode detection and getStripe guard (reads process.env) ----
delete process.env.STRIPE_SECRET_KEY;
ok(B.billingConfigured() === false && B.isLiveMode() === false, 'unset key: not configured, not live');
let e = throwsCode(() => B.getStripe());
ok(e?.status === 503 && e.code === 'billing_not_configured', 'getStripe refuses without a key');
process.env.STRIPE_SECRET_KEY = 'garbage';
e = throwsCode(() => B.getStripe());
ok(e?.code === 'billing_not_configured' && B.billingConfigured() === false, 'getStripe refuses a malformed key');
process.env.STRIPE_SECRET_KEY = TEST;
ok(B.billingConfigured() === true && B.isLiveMode() === false, 'a test key is configured but not live');
process.env.STRIPE_SECRET_KEY = LIVE;
ok(B.billingConfigured() === true && B.isLiveMode() === true, 'a live key is configured and live');
delete process.env.STRIPE_SECRET_KEY;
delete process.env.BILLING_PAYMENTS_ENABLED;
e = throwsCode(() => B.assertPaymentsEnabled());
ok(e?.status === 503 && e.code === 'payments_unavailable' && /Nothing was charged/.test(e.message), 'assertPaymentsEnabled refuses with "Nothing was charged"');

// ---- priceIdFor / introCouponFor / billingScope ----
process.env.STRIPE_BOLT_PRICE_ID = 'price_ABC123';
process.env.STRIPE_BOLT_YEARLY_PRICE_ID = 'price_YEAR9';
process.env.STRIPE_FLASH_PRICE_ID = 'not-a-price';
ok(B.priceIdFor('bolt') === 'price_ABC123' && B.priceIdFor('bolt', 'month') === 'price_ABC123', 'monthly price id is read from STRIPE_<PLAN>_PRICE_ID');
ok(B.priceIdFor('bolt', 'year') === 'price_YEAR9', 'yearly price id is read from STRIPE_<PLAN>_YEARLY_PRICE_ID');
ok(B.priceIdFor('bolt', 'week') === null, 'an unknown interval gives null');
ok(B.priceIdFor('flash') === null, 'a malformed price id gives null');
ok(B.priceIdFor('thunder') === null, 'an unset price id gives null');
process.env.STRIPE_FLASH_INTRO_COUPON = 'intro_1-ok';
process.env.STRIPE_BOLT_INTRO_COUPON = 'bad coupon!';
ok(B.introCouponFor('flash') === 'intro_1-ok', 'a valid intro coupon id is returned');
ok(B.introCouponFor('bolt') === null && B.introCouponFor('thunder') === null, 'invalid or missing coupon ids give null');
delete process.env.BILLING_SCOPE;
ok(B.billingScope() === 'app', 'billing scope defaults to "app"');
process.env.BILLING_SCOPE = 'qa:run-1';
ok(B.billingScope() === 'qa:run-1', 'a valid scope is used');
process.env.BILLING_SCOPE = 'Bad Scope';
ok(B.billingScope() === 'app', 'an invalid scope falls back to "app"');

// ---- appOrigin ----
delete process.env.APP_URL;
const req = (host, fwd) => ({ headers: { host, ...(fwd && { 'x-forwarded-host': fwd }) } });
ok(B.appOrigin(req('localhost:5173')) === 'http://localhost:5173', 'localhost is allowed over http');
ok(B.appOrigin(req('www.spark-scribe.com')) === 'https://www.spark-scribe.com', 'the production host is allowed over https');
ok(B.appOrigin(req('sparkscribe-git-x.vercel.app')) === 'https://sparkscribe-git-x.vercel.app', 'preview hosts are allowed');
ok(B.appOrigin(req('internal', 'SPARK-SCRIBE.com, other.example')) === 'https://spark-scribe.com', 'the first forwarded host wins, lower-cased');
e = throwsCode(() => B.appOrigin(req('evil.example.com')));
ok(e?.code === 'bad_origin' && e.status === 400, 'any other host is refused');
e = throwsCode(() => B.appOrigin(req('sparkscribe.vercel.app.evil.com')));
ok(e?.code === 'bad_origin', 'a look-alike host is refused');
process.env.APP_URL = 'https://app.example.org';
ok(B.appOrigin(req('evil.example.com')) === 'https://app.example.org', 'APP_URL overrides the host');
process.env.APP_URL = 'http://insecure.example';
e = throwsCode(() => B.appOrigin(req('evil.example.com')));
ok(e?.code === 'bad_origin', 'a non-https APP_URL is ignored');

console.log(`${pass} checks passed`);
