// How scripts/stripe-setup.mjs gets its Stripe key (scripts/stripe-key.mjs), including the way stripe-live-setup.mjs
// starts it. Regression for 2026-10-20: the live setup handed the child a restricted setup key (rk_live_…) through its
// environment and the child refused it ("STRIPE_SECRET_KEY (sk_test_… or sk_live_…) is not set in .env.local"),
// because it only accepted sk_ keys. No network: the child is run with --check-key, which stops before any Stripe call.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolveStripeKey } from '../scripts/stripe-key.mjs';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const root = new URL('../', import.meta.url);
const FAKE_RK_LIVE = 'rk_live_' + 'Q'.repeat(24); // fake, never valid
const FAKE_SK_TEST = 'sk_test_' + 'Z'.repeat(24);

// ---- resolveStripeKey
ok(resolveStripeKey({ argv: ['--key-from-env', '--expect-mode', 'live'], env: { STRIPE_SECRET_KEY: FAKE_RK_LIVE } }).live === true, 'a restricted live key (rk_live_) handed over in the environment is accepted');
ok(resolveStripeKey({ argv: ['--key-from-env', '--expect-mode', 'live'], env: { STRIPE_SECRET_KEY: FAKE_RK_LIVE } }).restricted === true, '…and recognized as restricted');
ok(/No Stripe key was handed over/.test(resolveStripeKey({ argv: ['--key-from-env'], env: {}, fileEnv: { STRIPE_SECRET_KEY: FAKE_SK_TEST } }).error), '--key-from-env never falls back to .env.local');
ok(/Expected a live key but got a test key/.test(resolveStripeKey({ argv: ['--key-from-env', '--expect-mode', 'live'], env: { STRIPE_SECRET_KEY: FAKE_SK_TEST } }).error), 'a test key is refused when live is expected');
ok(resolveStripeKey({ argv: [], env: {}, fileEnv: { STRIPE_SECRET_KEY: FAKE_SK_TEST } }).source === '.env.local', 'run on its own (QA), the test key from .env.local still works');
ok(resolveStripeKey({ argv: [], env: { STRIPE_SECRET_KEY: FAKE_RK_LIVE }, fileEnv: { STRIPE_SECRET_KEY: FAKE_SK_TEST } }).key === FAKE_RK_LIVE, 'the environment wins over .env.local');
ok(/not a Stripe secret/.test(resolveStripeKey({ argv: [], env: { STRIPE_SECRET_KEY: 'pk_live_abc' } }).error), 'a publishable key is refused');

// ---- the child as the parent starts it (same arguments, key only in the environment)
const child = (env, extra = []) => spawnSync(process.execPath, ['scripts/stripe-setup.mjs', '--key-from-env', '--expect-mode', 'live', '--check-key', ...extra],
  { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env } });
const r1 = child({ STRIPE_SECRET_KEY: FAKE_RK_LIVE });
ok(r1.status === 0 && /key ok: live restricted key from the environment/.test(r1.stdout), `the exact failing hand-over now works (${(r1.stdout + r1.stderr).trim()})`);
ok(!(r1.stdout + r1.stderr).includes(FAKE_RK_LIVE), 'the key is never printed');
const r2 = child({});
ok(r2.status === 1 && /No Stripe key was handed over/.test(r2.stderr) && !/key ok/.test(r2.stdout), 'no key handed over: the child stops (the test key in .env.local is not used)');
const r3 = child({ STRIPE_SECRET_KEY: FAKE_SK_TEST });
ok(r3.status === 1 && /Expected a live key/.test(r3.stderr), 'a test key under a live run: the child stops');

// ---- the parent passes the key through the environment only, and keeps the two keys apart
const src = readFileSync(new URL('scripts/stripe-live-setup.mjs', root), 'utf8');
const call = src.slice(src.indexOf("spawnSync(process.execPath, ['scripts/stripe-setup.mjs'"), src.indexOf("encoding: 'utf8' });", src.indexOf("spawnSync(process.execPath, ['scripts/stripe-setup.mjs'")));
const args = call.slice(0, call.indexOf(']'));
ok(/'--key-from-env', '--expect-mode', mode/.test(args) && !/setupKey|runtimeKey/.test(args), 'parent: the child gets --key-from-env and --expect-mode, and no key on its command line');
ok(/env: \{ \.\.\.process\.env, STRIPE_SECRET_KEY: setupKey \}/.test(call) && !/runtimeKey/.test(call), 'parent: the child gets the SETUP key (not the runtime key) in its environment');
console.log(`\n${pass} checks passed`);
