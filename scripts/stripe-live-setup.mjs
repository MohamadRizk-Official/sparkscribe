// LIVE Stripe setup for Production, run by the owner in their own terminal. Keys are typed at a hidden prompt, kept
// only in this process's memory, and never printed or written to disk.
//
//   node scripts/stripe-live-setup.mjs            (live)
//   node scripts/stripe-live-setup.mjs --dry-run  (rehearsal with the TEST key from .env.local; no webhook, no Vercel)
//
// Two keys, two roles (scripts/stripe-permissions.mjs has the exact lists):
//   SETUP key   — temporary: a restricted key with Write on Products, Prices, Coupons, Customer portal, Webhook Endpoints,
//                 Checkout Sessions (or the account's secret key). Delete it afterwards.
//   RUNTIME key — what Production keeps: a restricted key with Write on Customers, Checkout Sessions, Subscriptions,
//                 Customer portal, Refunds and Read on Invoices, Invoice payments, Subscription schedules. Nothing more.
// Steps: check both keys' permissions (nothing is changed) → check the account → create or reuse the products, monthly +
// yearly prices, the Flash $1 coupon, the Customer Portal (with Terms/Privacy links) and the signed webhook for
// https://www.spark-scribe.com/api/stripe-webhook (reused when Vercel already has its secret) → probe a live Checkout per
// plan and interval with the RUNTIME key (expired at once: nobody is charged) → write the server variables to Vercel
// Production (keys and the webhook secret as Sensitive, through stdin) → run scripts/billing-check.mjs.
// It does NOT turn payments on (BILLING_PAYMENTS_ENABLED, VITE_PAID_PLANS, BILLING_LIVE_APPROVED stay as they are).
import Stripe from 'stripe';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import readline from 'node:readline';
import { RUNTIME, SETUP, NOT_FOR_RUNTIME, probe, report } from './stripe-permissions.mjs';

const SITE = 'https://www.spark-scribe.com';
const WEBHOOK = `${SITE}/api/stripe-webhook`;
const SECRET_FILE = 'whsec-live.txt';
const win = process.platform === 'win32';
const DRY = process.argv.includes('--dry-run');
const mode = DRY ? 'test' : 'live';

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); else if (!/[\r\n]/.test(s)) rl.output.write('*'); };
    rl.question(question, (a) => { rl.close(); process.stdout.write('\n'); resolve(a.trim()); });
  });
}
const cleanup = () => { if (existsSync(SECRET_FILE)) rmSync(SECRET_FILE, { force: true }); };
const fail = (m) => { console.error(`\n✗ ${m}\nNothing was switched on.`); cleanup(); process.exit(1); };
process.on('exit', cleanup);
const fromLocal = (name) => (readFileSync('.env.local', 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1] || '').trim();
const vercel = (args, input) => spawnSync(win ? 'npx.cmd' : 'npx', ['--yes', 'vercel@latest', ...args], { input, encoding: 'utf8', shell: win });

console.log(DRY ? 'DRY RUN with the test key from .env.local (no webhook, no Vercel changes).\n'
  : 'SparkScribe LIVE Stripe setup. Keys are hidden while you type and are never stored or printed.\n');

// ---- 1. the two keys and their permissions (checked without changing anything)
const setupKey = DRY ? fromLocal('STRIPE_SECRET_KEY') : await ask('SETUP key (restricted rk_live_… with the setup permissions, or sk_live_…): ');
if (!new RegExp(`^(rk|sk)_${mode}_[A-Za-z0-9]+$`).test(setupKey)) fail(`That is not a ${mode} Stripe key.`);
const runtimeKey = DRY ? fromLocal('STRIPE_SECRET_KEY') : await ask('RUNTIME key for Production (restricted rk_live_… with the runtime permissions): ');
if (!DRY && !/^rk_live_[A-Za-z0-9]+$/.test(runtimeKey)) fail('Production needs a RESTRICTED live key (rk_live_…), not the secret key. Create it in Dashboard → Developers → API keys → Create restricted key.');
if (!DRY && runtimeKey === setupKey) fail('Use two different keys: the setup key is temporary and must not stay in Production.');

const stripe = new Stripe(setupKey);
const runtime = new Stripe(runtimeKey);
console.log('Setup key permissions:');
const sp = await probe(stripe, SETUP);
console.log(report(sp));
console.log('\nRuntime key permissions:');
const rp = await probe(runtime, RUNTIME);
console.log(report(rp));
const extra = (await probe(runtime, NOT_FOR_RUNTIME)).filter((r) => r.result === 'ok').map((r) => r.label);
if (extra.length) console.log(`${DRY ? '·' : '✗'} the runtime key can also write ${extra.join(', ')}: set ${extra.length > 1 ? 'them' : 'it'} to None (Production never needs ${extra.length > 1 ? 'them' : 'it'})`);
const missing = [...sp.filter((r) => r.result !== 'ok').map((r) => `setup key: ${r.label} ${r.level}`), ...rp.filter((r) => r.result !== 'ok').map((r) => `runtime key: ${r.label} ${r.level}`)];
if (missing.length) fail(`Add these permissions (Dashboard → Developers → API keys → ⋯ → Edit key), then run again:\n  - ${missing.join('\n  - ')}`);
if (extra.length && !DRY) fail('The runtime key has more permissions than Production needs (above).');

// ---- 2. the account (a restricted key may not be allowed to read it; the Checkout probe below then decides)
const acct = await stripe.accounts.retrieve().catch((e) => (e.statusCode === 403 ? null : fail(`Stripe refused the key: ${e.message}`)));
if (!acct) console.log('\n· the setup key can’t read the account status; the live Checkout probe below checks the account can take payments');
else {
  console.log(`\nAccount: ${acct.business_profile?.name || acct.settings?.dashboard?.display_name || '(no public name)'}`);
  const need = [];
  if (!acct.charges_enabled) need.push('the account cannot take live charges yet: finish activation in the Stripe Dashboard');
  if (!acct.payouts_enabled) need.push('payouts are not enabled: add/verify the bank account');
  if (!acct.business_profile?.support_email) need.push('Settings → Public details: add the support email (contact.hrstudios@gmail.com)');
  if (acct.requirements?.currently_due?.length) need.push(`Stripe still needs: ${acct.requirements.currently_due.join(', ')}`);
  if (need.length && DRY) console.log(`(dry run) live mode would stop here:\n  - ${need.join('\n  - ')}`);
  else if (need.length) fail(`Stripe account not ready:\n  - ${need.join('\n  - ')}`);
  else console.log('✓ charges and payouts enabled, support email set');
}

// ---- 3. products, prices, coupon, portal, webhook (reused when they exist; nothing is duplicated)
const vercelNames = DRY ? '' : (vercel(['env', 'ls', 'production']).stdout || '');
const vercelHas = (n) => new RegExp(`^\\s*${n}\\s`, 'm').test(vercelNames);
let keepSecret = false;
if (!DRY) {
  const wh = (await stripe.webhookEndpoints.list({ limit: 100 })).data.find((w) => w.url === WEBHOOK);
  if (wh && vercelHas('STRIPE_WEBHOOK_SECRET')) { keepSecret = true; console.log(`\n· the live webhook ${wh.id} exists and Vercel has its secret: kept`); }
  else if (wh) {
    console.log(`\nThe live webhook ${wh.id} exists but Vercel has no secret for it: replacing it (Stripe shows a secret only at creation).`);
    await stripe.webhookEndpoints.del(wh.id);
  }
}
console.log('\nCreating or finding the live products, prices, coupon, portal and webhook…');
const setup = spawnSync(process.execPath, ['scripts/stripe-setup.mjs', ...(DRY ? [] : ['--webhook-url', WEBHOOK, '--secret-out', SECRET_FILE]), '--legal-base', SITE],
  { env: { ...process.env, STRIPE_SECRET_KEY: setupKey }, encoding: 'utf8' });
process.stdout.write(setup.stdout.split('\nServer environment variables')[0] + '\n');
if (setup.status !== 0) fail(`stripe-setup failed: ${setup.stderr.trim()}`);
const ids = Object.fromEntries([...setup.stdout.matchAll(/^(STRIPE_[A-Z_]+)=(\S+)$/gm)].map((m) => [m[1], m[2]]));
const want = ['FLASH', 'BOLT', 'THUNDER'].flatMap((p) => [`STRIPE_${p}_PRICE_ID`, `STRIPE_${p}_YEARLY_PRICE_ID`]).concat(['STRIPE_FLASH_INTRO_COUPON', 'STRIPE_PORTAL_CONFIGURATION_ID']);
const absent = want.filter((k) => !ids[k]);
if (absent.length) fail(`setup did not return ${absent.join(', ')}`);
const whsec = DRY ? 'whsec_dryrun' : keepSecret ? null : existsSync(SECRET_FILE) ? readFileSync(SECRET_FILE, 'utf8').trim() : '';
cleanup();
if (whsec !== null && !/^whsec_/.test(whsec)) fail('no webhook signing secret was returned');
if (whsec && !DRY) console.log('✓ new webhook signing secret received (kept in memory only)');

// ---- 4. a live Checkout probe per plan and interval, with the runtime key (never paid: expired at once)
console.log('\nProbing Checkout with the runtime key (each session is expired immediately; nobody is charged)…');
for (const k of ['FLASH', 'BOLT', 'THUNDER']) {
  for (const y of ['', '_YEARLY']) {
    try {
      const s = await runtime.checkout.sessions.create({
        mode: 'subscription', line_items: [{ price: ids[`STRIPE_${k}${y}_PRICE_ID`], quantity: 1 }], success_url: `${SITE}/account?checkout=success`, cancel_url: `${SITE}/pricing?checkout=canceled`,
        ...(DRY ? {} : { consent_collection: { terms_of_service: 'required' } }), custom_text: { submit: { message: 'SparkScribe configuration check' } },
        ...(k === 'FLASH' && !y ? { discounts: [{ coupon: ids.STRIPE_FLASH_INTRO_COUPON }] } : { allow_promotion_codes: false }),
        metadata: { sparkscribe_probe: '1', sparkscribe_scope: 'probe' },
      });
      await runtime.checkout.sessions.expire(s.id);
      console.log(`✓ ${k.toLowerCase()}${y ? ' yearly' : ' monthly'}: ${(s.amount_total / 100).toFixed(2)} ${s.currency.toUpperCase()} today${k === 'FLASH' && !y ? ' (the $1 first month)' : ''}`);
    } catch (e) {
      fail(`Checkout probe failed for ${k}${y}: ${e.message.replace(/(sk|rk)_(live|test)_[A-Za-z0-9]+/g, '<key>')}${/terms of service/i.test(e.message) ? `\n  → Stripe Dashboard → Settings → Public details: add the Terms of service URL ${SITE}/terms` : ''}${/live charges|activate/i.test(e.message) ? '\n  → finish activating the Stripe account' : ''}`);
    }
  }
}

// ---- 5. Vercel Production variables
const vars = { STRIPE_SECRET_KEY: [runtimeKey, true], ...(whsec ? { STRIPE_WEBHOOK_SECRET: [whsec, true] } : {}), STRIPE_REQUIRE_TOS: ['1', false], ...Object.fromEntries(want.map((k) => [k, [ids[k], false]])) };
console.log(DRY ? '\n(dry run: Vercel not changed)' : '\nWriting the variables to Vercel Production…');
for (const [name, [value, sensitive]] of DRY ? [] : Object.entries(vars)) {
  // the value goes through stdin (never on the command line); --force replaces an earlier value
  const r = vercel(['env', 'add', name, 'production', '--force', '--yes', sensitive ? '--sensitive' : '--no-sensitive'], value);
  if (r.status !== 0) fail(`Vercel refused ${name}: ${(r.stderr || r.stdout).split('\n').filter(Boolean).slice(-1)[0]}`);
  console.log(`✓ ${name}${sensitive ? ' (sensitive)' : ''}`);
}
if (keepSecret) console.log('· STRIPE_WEBHOOK_SECRET unchanged (the webhook was kept)');

// ---- 6. readiness check against the live configuration
console.log(`\nReadiness check (${mode}):`);
const check = spawnSync(process.execPath, ['scripts/billing-check.mjs', '--env', 'nonexistent.env', ...(DRY ? [] : ['--webhook-url', WEBHOOK])], {
  env: { ...process.env, STRIPE_SECRET_KEY: setupKey, STRIPE_WEBHOOK_SECRET: whsec || 'whsec_kept_in_vercel', STRIPE_REQUIRE_TOS: '1', ...ids,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || fromLocal('NEXT_PUBLIC_SUPABASE_URL'),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || fromLocal('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') },
  encoding: 'utf8',
});
process.stdout.write(check.stdout);
if (check.status !== 0) fail('the readiness check found problems (above)');
if (DRY) console.log('\nDry run passed (test mode). Nothing was changed in Vercel.');
else {
  console.log('\nDone. Live Stripe is configured in Vercel Production. Payments are still OFF.');
  console.log('Now delete the SETUP key in Dashboard → Developers → API keys (if it was a restricted key; roll the secret key otherwise).');
  console.log('Then tell Claude "live setup done".');
}
