// Which Stripe key scripts/stripe-setup.mjs uses (tests/stripe-key-test.mjs).
//   * Run on its own: STRIPE_SECRET_KEY from the environment, else from .env.local (the test-mode key used in QA).
//   * Run by scripts/stripe-live-setup.mjs (--key-from-env): ONLY the environment variable the parent set from its hidden
//     prompt. .env.local is never consulted for the key, so a live run can never fall back to the local test key.
//   * --expect-mode live|test: the key must be of that mode.
// Accepts secret (sk_) and restricted (rk_) keys. Never prints the key.
export function resolveStripeKey({ argv = [], env = {}, fileEnv = {} } = {}) {
  const fromEnvOnly = argv.includes('--key-from-env');
  const i = argv.indexOf('--expect-mode');
  const expect = i >= 0 ? argv[i + 1] : null;
  if (expect && !['live', 'test'].includes(expect)) return { error: '--expect-mode must be live or test' };
  const key = String((fromEnvOnly ? env.STRIPE_SECRET_KEY : env.STRIPE_SECRET_KEY || fileEnv.STRIPE_SECRET_KEY) || '').trim();
  if (!key) return { error: fromEnvOnly ? 'No Stripe key was handed over by the parent (STRIPE_SECRET_KEY in this process\'s environment).' : 'STRIPE_SECRET_KEY is not set (environment or .env.local).' };
  const m = /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.exec(key);
  if (!m) return { error: 'STRIPE_SECRET_KEY is not a Stripe secret (sk_…) or restricted (rk_…) key.' };
  const mode = m[2];
  if (expect && mode !== expect) return { error: `Expected a ${expect} key but got a ${mode} key.` };
  return { key, live: mode === 'live', restricted: m[1] === 'rk', source: fromEnvOnly || env.STRIPE_SECRET_KEY ? 'environment' : '.env.local' };
}
