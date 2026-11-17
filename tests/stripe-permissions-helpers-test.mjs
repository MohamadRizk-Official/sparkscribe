// Small helpers of the Stripe key checker (scripts/stripe-permissions.mjs): isAuthError, classifyExcess, clean, report, reportExcess.
import assert from 'node:assert/strict';
const S = await import(new URL('../scripts/stripe-permissions.mjs', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

// ---- isAuthError ----
ok(S.isAuthError({ statusCode: 401 }) === true, 'a 401 is a rejected key');
ok(S.isAuthError({ type: 'StripeAuthenticationError' }) === true, 'a StripeAuthenticationError is a rejected key');
ok(S.isAuthError({ statusCode: 403 }) === false, 'a 403 is a permission problem, not a rejected key');
ok(S.isAuthError(null) === false && S.isAuthError(undefined) === false, 'no error is not an auth error');

// ---- classifyExcess ----
ok(S.classifyExcess(null) === 'readable', 'a read that succeeds is readable');
ok(S.classifyExcess({ statusCode: 403 }) === 'none', 'a 403 on read means no read permission');
ok(S.classifyExcess({ type: 'StripePermissionError' }) === 'none', 'a StripePermissionError means no read permission');
ok(S.classifyExcess({ message: 'The provided key does not have the required permissions for this endpoint' }) === 'none', 'the "required permissions" message means no read permission');
ok(S.classifyExcess({ statusCode: 500 }) === 'inconclusive', 'any other failure is inconclusive');

// ---- clean ----
const dirty = 'Invalid API Key provided: rk_live_****abcd and sk_test_51Abc123 pk_live_xyz';
const c = S.clean(dirty);
ok(!/_(live|test)_/.test(c), 'every key shape is removed, masked or not');
ok(c.split('<key>').length === 4, 'each of the three keys is replaced by <key>');
ok(S.clean(null) === '' && S.clean(undefined) === '', 'clean tolerates missing text');
ok(S.clean('x'.repeat(500)).length === 200, 'clean cuts the text to 200 characters');

// ---- report ----
const rows = [
  { label: 'Customers', level: 'Write', why: 'create customers', endpoint: 'POST /v1/customers', result: 'ok', evidence: 'HTTP 400' },
  { label: 'Prices', level: 'Read', why: 'read prices', endpoint: 'GET /v1/prices', result: 'missing', evidence: 'HTTP 403' },
  { label: 'Events', level: 'Read', why: 'read events', endpoint: 'GET /v1/events', result: 'error', evidence: 'HTTP 500', detail: 'timed out' },
];
const lines = S.report(rows).split('\n');
ok(lines.length === 3, 'one report line per row');
ok(lines[0].startsWith('✓ Customers') && !lines[0].includes('MISSING'), 'an ok row has a tick and no warning');
ok(lines[1].startsWith('✗ Prices') && lines[1].includes('MISSING (needed to read prices)'), 'a missing row says what it is needed for');
ok(lines[2].includes('could not check: timed out'), 'an error row shows its detail');
ok(S.report([{ ...rows[0], result: 'auth' }]).includes('KEY REJECTED'), 'an auth row says the key was rejected');

// ---- reportExcess ----
const ex = (result, readResult) => ({ label: 'Refunds', permission: 'Write', result, writes: [{ endpoint: 'POST /v1/refunds', evidence: 'HTTP 403' }], read: { endpoint: 'GET /v1/refunds', evidence: 'HTTP 200', result: readResult } });
ok(S.reportExcess([ex('none', 'none')]).includes('✓ Refunds: cannot change'), 'no write permission reads as cannot change');
ok(S.reportExcess([ex('excess', 'readable')]).includes('CAN CHANGE'), 'excess permission is flagged as CAN CHANGE');
ok(S.reportExcess([ex('inconclusive', 'none')]).includes("can't tell"), 'an inconclusive row says so');
ok(S.reportExcess([ex('none', 'readable')]).includes('readable (informational'), 'a readable catalog is informational only');
ok(S.reportExcess([ex('none', 'none')]).includes('[POST /v1/refunds → HTTP 403]'), 'the write answers are listed as evidence');

console.log(`${pass} checks passed`);
