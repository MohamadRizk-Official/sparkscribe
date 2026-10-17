// Payment readiness check: is this Stripe configuration (test or LIVE) consistent with the plans on the site?
// Read-only. Never prints a key or a secret, only ids, amounts and ✓ / ✗.
//
//   node scripts/billing-check.mjs [--env <file>] [--webhook-url https://<host>/api/stripe-webhook]
//
// Reads the server variables from --env (default .env.local) and the environment: STRIPE_SECRET_KEY,
// STRIPE_WEBHOOK_SECRET, STRIPE_<PLAN>_PRICE_ID, STRIPE_<PLAN>_YEARLY_PRICE_ID, STRIPE_FLASH_INTRO_COUPON,
// STRIPE_PORTAL_CONFIGURATION_ID, BILLING_* flags, and the public Supabase URL/key (for the plan table).
// Checks: the account can take charges; every paid plan's monthly and yearly Stripe price exists, is active and matches
// billing_plans exactly (amount, currency, interval, same product); the Flash intro coupon is $4.99 off, once, Flash
// only; the Customer Portal configuration lists both prices of every plan, cancels at period end and links the Terms and
// Privacy Policy; the webhook endpoint (with --webhook-url) is enabled with every event the server handles; the switches.
// Exit code 1 if anything required is wrong.
import Stripe from 'stripe';
import { readFileSync } from 'node:fs';

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const file = arg('--env') || '.env.local';
const fromFile = (() => { try { return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].trim().replace(/^"|"$/g, '')])); } catch { return {}; } })();
const env = { ...fromFile, ...process.env };
const webhookUrl = arg('--webhook-url');
const EVENTS = ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'customer.subscription.paused', 'customer.subscription.resumed', 'invoice.paid', 'invoice.payment_failed', 'invoice.payment_action_required'];

let bad = 0;
const ok = (c, m, note = '') => { if (!c) bad++; console.log(`${c ? '✓' : '✗'} ${m}${note ? `  (${note})` : ''}`); return c; };
const info = (m) => console.log(`· ${m}`);

const key = env.STRIPE_SECRET_KEY || '';
if (!ok(/^(sk|rk)_(test|live)_/.test(key), 'STRIPE_SECRET_KEY is a Stripe secret or restricted key')) process.exit(1);
const live = /^(sk|rk)_live_/.test(key);
info(`mode: ${live ? 'LIVE' : 'test'}${key.startsWith('rk_') ? ' (restricted key)' : ''}`);
const stripe = new Stripe(key);

const acct = await stripe.accounts.retrieve().catch((e) => ({ error: e.message }));
if (acct.error) ok(false, 'Stripe account readable', acct.error);
else {
  ok(acct.charges_enabled, 'the Stripe account can accept charges');
  if (live) ok(acct.payouts_enabled, 'payouts are enabled');
  info(`business: ${acct.business_profile?.name || acct.settings?.dashboard?.display_name || '(no public name)'}; support email ${acct.business_profile?.support_email ? 'set' : 'NOT set'}`);
}

// the plans as the site shows them
const sbUrl = env.NEXT_PUBLIC_SUPABASE_URL, sbKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const plans = (await (await fetch(`${sbUrl}/rest/v1/billing_plans?select=key,name,price_cents,yearly_price_cents,currency,billing_interval,intro_price_cents,intro_months&tier=not.is.null&order=tier`, { headers: { apikey: sbKey } })).json()).filter((p) => p.billing_interval);
ok(plans.length === 3, `three paid plans in billing_plans (${plans.map((p) => p.key).join(', ')})`);

const portalProducts = new Map();
for (const p of plans) {
  const K = p.key.toUpperCase();
  const check = async (envName, cents, interval) => {
    const id = env[envName];
    if (!ok(/^price_[A-Za-z0-9]+$/.test(id || ''), `${envName} set`)) return null;
    const pr = await stripe.prices.retrieve(id).catch(() => null);
    if (!ok(pr, `${envName} exists in this Stripe ${live ? 'LIVE' : 'test'} account`)) return null;
    ok(pr.active && pr.unit_amount === cents && pr.currency === p.currency && pr.recurring?.interval === interval && (pr.recurring?.interval_count ?? 1) === 1,
      `${p.name} ${interval}ly: ${(cents / 100).toFixed(2)} ${p.currency.toUpperCase()} every ${interval}`, `Stripe: ${pr.active ? '' : 'INACTIVE '}${pr.unit_amount} ${pr.currency}/${pr.recurring?.interval}`);
    if (pr.tax_behavior === 'unspecified') info(`${envName}: no tax behavior set (Stripe Tax uses the account default)`);
    return pr;
  };
  const m = await check(`STRIPE_${K}_PRICE_ID`, p.price_cents, 'month');
  const y = p.yearly_price_cents ? await check(`STRIPE_${K}_YEARLY_PRICE_ID`, p.yearly_price_cents, 'year') : null;
  if (m && y) ok(m.product === y.product, `${p.name}: monthly and yearly prices on the same product`);
  if (m) portalProducts.set(m.product, [m.id, y?.id].filter(Boolean));
  if (p.intro_price_cents != null) {
    const cid = env[`STRIPE_${K}_INTRO_COUPON`];
    const c = cid ? await stripe.coupons.retrieve(cid, { expand: ['applies_to'] }).catch(() => null) : null;
    ok(c && c.valid && c.amount_off === p.price_cents - p.intro_price_cents && c.currency === p.currency && c.duration === 'once' && (!m || c.applies_to?.products?.includes(m.product)),
      `${p.name} intro coupon: ${((p.price_cents - p.intro_price_cents) / 100).toFixed(2)} off the first month, ${p.name} only`, cid ? '' : `STRIPE_${K}_INTRO_COUPON not set`);
  }
}

// Customer Portal
const pcid = env.STRIPE_PORTAL_CONFIGURATION_ID;
const pc = /^bpc_/.test(pcid || '') ? await stripe.billingPortal.configurations.retrieve(pcid, { expand: ['features.subscription_update.products'] }).catch(() => null) : null;
if (ok(pc && pc.active, 'STRIPE_PORTAL_CONFIGURATION_ID: an active portal configuration')) {
  const prods = pc.features.subscription_update.products;
  const listed = new Map(((prods?.data ?? prods) || []).map((x) => [x.product, x.prices]));
  ok([...portalProducts].every(([prod, ids]) => ids.every((id) => listed.get(prod)?.includes(id))), 'the portal lets customers switch between every plan, monthly and yearly');
  ok(pc.features.subscription_cancel.enabled && pc.features.subscription_cancel.mode === 'at_period_end', 'cancellation in the portal ends at the period end');
  ok(pc.features.payment_method_update.enabled && pc.features.invoice_history.enabled, 'card update and invoices in the portal');
  ok(!live || (pc.business_profile?.terms_of_service_url && pc.business_profile?.privacy_policy_url), 'the portal links the Terms and Privacy Policy', live ? '' : 'required for live');
}

// webhook
ok(/^whsec_/.test(env.STRIPE_WEBHOOK_SECRET || ''), 'STRIPE_WEBHOOK_SECRET set');
if (webhookUrl) {
  const w = (await stripe.webhookEndpoints.list({ limit: 100 })).data.find((x) => x.url === webhookUrl);
  if (ok(w, `a webhook endpoint for ${new URL(webhookUrl).host}`)) {
    ok(w.status === 'enabled', 'the endpoint is enabled');
    ok(EVENTS.every((e) => w.enabled_events.includes(e) || w.enabled_events.includes('*')), 'it sends every event the server handles', EVENTS.filter((e) => !w.enabled_events.includes(e)).join(', '));
    ok(!w.api_version || w.api_version === Stripe.API_VERSION, `its API version matches the server library (${Stripe.API_VERSION})`, w.api_version || 'account default');
  }
} else info('webhook endpoint not checked (pass --webhook-url https://<host>/api/stripe-webhook)');

// switches (reported; turning them on is a separate, deliberate step)
info(`BILLING_PAYMENTS_ENABLED=${env.BILLING_PAYMENTS_ENABLED === '1' ? '1' : 'off'}; VITE_PAID_PLANS=${env.VITE_PAID_PLANS === '1' ? '1' : 'off'}${live ? `; BILLING_LIVE_APPROVED=${env.BILLING_LIVE_APPROVED === '1' ? '1' : 'off'}` : ''}; STRIPE_AUTOMATIC_TAX=${env.STRIPE_AUTOMATIC_TAX === '1' ? '1' : 'off'}; STRIPE_REQUIRE_TOS=${env.STRIPE_REQUIRE_TOS === '1' ? '1' : 'off'}`);
info('not checkable by API: yearly renewal reminder emails (Stripe Dashboard → Settings → Billing → Subscriptions and emails); confirm one arrives with a test clock');
console.log(bad ? `\n${bad} problem(s): fix before enabling payments.` : '\nAll checks passed.');
process.exit(bad ? 1 : 0);
