// LIVE Stripe setup for Production, run by the owner in their own terminal. Keys are typed at a hidden prompt, kept
// only in this process's memory, and never printed or written to disk.
//
//   node scripts/stripe-live-setup.mjs
//
// 1. asks for the live SECRET key (sk_live_…, used only here for setup) and the live RESTRICTED key for the server
//    (rk_live_…; leave empty to use the secret key)
// 2. checks the Stripe account can take live payments and has the public details Checkout needs
// 3. runs scripts/stripe-setup.mjs in live mode: products, monthly + yearly prices, the Flash $1 coupon, the Customer
//    Portal (with the Terms and Privacy links) and the signed webhook for https://www.spark-scribe.com/api/stripe-webhook
// 4. probes a live Checkout session for each plan and interval (created, read back, expired at once: nobody is charged)
// 5. writes the server variables to Vercel PRODUCTION (keys and the webhook secret as Sensitive)
// 6. runs scripts/billing-check.mjs against the live configuration
// It does NOT turn payments on (BILLING_PAYMENTS_ENABLED, VITE_PAID_PLANS, BILLING_LIVE_APPROVED stay unset).
import Stripe from 'stripe';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import readline from 'node:readline';

const SITE = 'https://www.spark-scribe.com';
const WEBHOOK = `${SITE}/api/stripe-webhook`;
const SECRET_FILE = 'whsec-live.txt';
const win = process.platform === 'win32';

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); else if (!/[\r\n]/.test(s)) rl.output.write('*'); };
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); });
  });
}
const fail = (m) => { console.error(`\n✗ ${m}\nNothing was switched on.`); cleanup(); process.exit(1); };
const cleanup = () => { if (existsSync(SECRET_FILE)) rmSync(SECRET_FILE, { force: true }); };
process.on('exit', cleanup);

// --dry-run: a rehearsal with the TEST key from .env.local; no webhook, nothing written to Vercel
const DRY = process.argv.includes('--dry-run');
const mode = DRY ? 'test' : 'live';
console.log(DRY ? 'DRY RUN with the test key from .env.local (no webhook, no Vercel changes).\n' : 'SparkScribe LIVE Stripe setup. Keys are hidden while you type and are never stored.\n');
const sk = DRY ? (readFileSync('.env.local', 'utf8').match(/^STRIPE_SECRET_KEY=(.*)$/m)?.[1] || '').trim() : await ask('Live SECRET key (sk_live_…): ', { hidden: true });
if (!new RegExp(`^sk_${mode}_[A-Za-z0-9]+$`).test(sk)) fail(`That is not a ${mode} secret key (sk_${mode}_…).`);
const rkIn = DRY ? '' : await ask('Live RESTRICTED key for the server (rk_live_…, Enter to use the secret key): ', { hidden: true });
if (rkIn && !/^rk_live_[A-Za-z0-9]+$/.test(rkIn)) fail('That is not a live restricted key (rk_live_…).');
const serverKey = rkIn || sk;

// ---- 2. the account
const stripe = new Stripe(sk);
const acct = await stripe.accounts.retrieve().catch((e) => fail(`Stripe refused the key: ${e.message}`));
console.log(`\nAccount: ${acct.business_profile?.name || acct.settings?.dashboard?.display_name || '(no public name)'}`);
const need = [];
if (!acct.charges_enabled) need.push('the account cannot take live charges yet: finish activation in the Stripe Dashboard');
if (!acct.payouts_enabled) need.push('payouts are not enabled: add/verify the bank account');
if (!acct.business_profile?.support_email) need.push('Settings → Public details: add the support email (contact.hrstudios@gmail.com)');
if (acct.requirements?.currently_due?.length) need.push(`Stripe still needs: ${acct.requirements.currently_due.join(', ')}`);
if (need.length && DRY) console.log(`(dry run) live mode would stop here:\n  - ${need.join('\n  - ')}`);
else if (need.length) fail(`Stripe account not ready:\n  - ${need.join('\n  - ')}`);
else console.log('✓ charges and payouts enabled, support email set');

// ---- 3. products, prices, coupon, portal, webhook
console.log('\nCreating or finding the live products, prices, coupon, portal and webhook…');
const setup = spawnSync(process.execPath, ['scripts/stripe-setup.mjs', ...(DRY ? [] : ['--webhook-url', WEBHOOK, '--secret-out', SECRET_FILE]), '--legal-base', SITE],
  { env: { ...process.env, STRIPE_SECRET_KEY: sk }, encoding: 'utf8' });
process.stdout.write(setup.stdout.split('\nServer environment variables')[0] + '\n');
if (setup.status !== 0) fail(`stripe-setup failed: ${setup.stderr.trim()}`);
const ids = Object.fromEntries([...setup.stdout.matchAll(/^(STRIPE_[A-Z_]+)=(\S+)$/gm)].map((m) => [m[1], m[2]]));
const want = ['FLASH', 'BOLT', 'THUNDER'].flatMap((p) => [`STRIPE_${p}_PRICE_ID`, `STRIPE_${p}_YEARLY_PRICE_ID`]).concat(['STRIPE_FLASH_INTRO_COUPON', 'STRIPE_PORTAL_CONFIGURATION_ID']);
const missing = want.filter((k) => !ids[k]);
if (missing.length) fail(`setup did not return ${missing.join(', ')}`);
let whsec = DRY ? 'whsec_dryrun' : existsSync(SECRET_FILE) ? readFileSync(SECRET_FILE, 'utf8').trim() : '';
cleanup();
if (!whsec && !DRY) {
  // the endpoint already existed, so Stripe won't show its secret again: make a new one
  const wh = (await stripe.webhookEndpoints.list({ limit: 100 })).data.find((w) => w.url === WEBHOOK);
  if (wh) {
    console.log('The live webhook already existed; replacing it so its signing secret can be set in Vercel.');
    await stripe.webhookEndpoints.del(wh.id);
    const again = spawnSync(process.execPath, ['scripts/stripe-setup.mjs', '--webhook-url', WEBHOOK, '--secret-out', SECRET_FILE, '--legal-base', SITE], { env: { ...process.env, STRIPE_SECRET_KEY: sk }, encoding: 'utf8' });
    if (again.status !== 0) fail('could not recreate the webhook');
    whsec = existsSync(SECRET_FILE) ? readFileSync(SECRET_FILE, 'utf8').trim() : '';
    cleanup();
  }
}
if (!/^whsec_/.test(whsec)) fail('no webhook signing secret');
console.log('✓ webhook signing secret received (kept in memory only)');

// ---- 4. a live Checkout probe per plan and interval (never paid: expired at once)
console.log('\nProbing live Checkout (each session is expired immediately; nobody is charged)…');
const probeStripe = new Stripe(serverKey);
for (const [k, intervals] of [['FLASH', ['', '_YEARLY']], ['BOLT', ['', '_YEARLY']], ['THUNDER', ['', '_YEARLY']]]) {
  for (const y of intervals) {
    const price = ids[`STRIPE_${k}${y}_PRICE_ID`];
    try {
      const s = await probeStripe.checkout.sessions.create({
        mode: 'subscription', line_items: [{ price, quantity: 1 }], success_url: `${SITE}/account`, cancel_url: `${SITE}/pricing`,
        ...(DRY ? {} : { consent_collection: { terms_of_service: 'required' } }), custom_text: { submit: { message: 'Probe' } },
        ...(k === 'FLASH' && !y ? { discounts: [{ coupon: ids.STRIPE_FLASH_INTRO_COUPON }] } : {}),
        metadata: { sparkscribe_probe: '1' },
      });
      await probeStripe.checkout.sessions.expire(s.id);
      console.log(`✓ ${k.toLowerCase()}${y ? ' yearly' : ' monthly'}: ${(s.amount_total / 100).toFixed(2)} ${s.currency.toUpperCase()} today${k === 'FLASH' && !y ? ' (with the $1 first month)' : ''}`);
    } catch (e) {
      fail(`Checkout probe failed for ${k}${y}: ${e.message}${/terms of service/i.test(e.message) ? '\n  → Stripe Dashboard → Settings → Public details: add the Terms of service URL ' + SITE + '/terms' : ''}${/permission|restricted/i.test(e.message) ? '\n  → give the restricted key Write access to Checkout Sessions' : ''}`);
    }
  }
}

// ---- 5. Vercel Production variables
console.log('\nWriting the variables to Vercel Production…');
const vars = { STRIPE_SECRET_KEY: [serverKey, true], STRIPE_WEBHOOK_SECRET: [whsec, true], STRIPE_REQUIRE_TOS: ['1', false], ...Object.fromEntries(want.map((k) => [k, [ids[k], false]])) };
const vercel = (args, input) => spawnSync(win ? 'npx.cmd' : 'npx', ['--yes', 'vercel@latest', ...args], { input, encoding: 'utf8', shell: win });
if (DRY) console.log('(dry run: Vercel not changed)');
for (const [name, [value, sensitive]] of DRY ? [] : Object.entries(vars)) {
  // the value goes through stdin (never on the command line), --force replaces an earlier value
  const r = vercel(['env', 'add', name, 'production', '--force', '--yes', sensitive ? '--sensitive' : '--no-sensitive'], value);
  if (r.status !== 0) fail(`Vercel refused ${name}: ${(r.stderr || r.stdout).split('\n').filter(Boolean).slice(-1)[0]}`);
  console.log(`✓ ${name}${sensitive ? ' (sensitive)' : ''}`);
}

// ---- 6. readiness check against the live configuration
console.log('\nReadiness check (live):');
const check = spawnSync(process.execPath, ['scripts/billing-check.mjs', '--env', 'nonexistent.env', ...(DRY ? [] : ['--webhook-url', WEBHOOK])], {
  env: { ...process.env, STRIPE_SECRET_KEY: sk, STRIPE_WEBHOOK_SECRET: whsec, STRIPE_REQUIRE_TOS: '1', ...ids,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || readFileSync('.env.local', 'utf8').match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m)?.[1]?.trim(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || readFileSync('.env.local', 'utf8').match(/^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=(.*)$/m)?.[1]?.trim() },
  encoding: 'utf8',
});
process.stdout.write(check.stdout);
if (check.status !== 0) fail('the live readiness check found problems (above)');
console.log('\nDone. Live Stripe is configured in Vercel Production. Payments are still OFF.');
console.log('Tell Claude "live setup done" to continue (database switch, payments on, controlled purchase).');
