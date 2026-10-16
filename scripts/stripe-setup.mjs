// One-time Stripe setup for SparkScribe (safe to re-run: it reuses what already exists).
//
//   node scripts/stripe-setup.mjs [--webhook-url https://.../api/stripe-webhook --secret-out <file>] [--legal-base https://<site>]
//                                 [--downgrades at-period-end|immediately]
//
// Reads STRIPE_SECRET_KEY (and the public Supabase URL/key) from the environment or .env.local. Never prints
// a secret. Creates, or finds by lookup key:
//   * one product + monthly price per paid plan of the four-tier lineup in billing_plans (Flash, Bolt, Thunder; prices
//     and names come from the database)
//   * for a plan with an introductory price (Flash: $1 first month), a coupon for the difference that applies to that
//     plan's product only, for the first month(s) only (duration "once"); the server adds it at Checkout for eligible
//     accounts
//   * a Customer Portal configuration: update payment method, invoices, switch between the paid plans, cancel at the end
//     of the period. Upgrades are prorated and invoiced at once; downgrades take effect at the end of the period
//     (--downgrades at-period-end, the default) or at once with a prorated credit (--downgrades immediately)
//   * optionally a webhook endpoint; its signing secret is written only to --secret-out (mode 600). Its events use
//     the same Stripe API version as the server's library. A Vercel protection-bypass query (?x-vercel-protection-bypass=…)
//     may be appended to the URL when the deployment is protected; the URL is never printed.
//   * products carry the Stripe Tax code for SaaS (personal use); new prices are tax-exclusive (tax added at Checkout
//     when STRIPE_AUTOMATIC_TAX=1 on the server)
//   * --legal-base: adds <base>/terms and <base>/privacy to the Customer Portal (needed before live payments)
// Prints the IDs to put in the server environment (STRIPE_<PLAN>_PRICE_ID, STRIPE_PORTAL_CONFIGURATION_ID).
import Stripe from 'stripe';
import { readFileSync, writeFileSync } from 'node:fs';

const env = { ...Object.fromEntries((() => { try { return readFileSync('.env.local', 'utf8').split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()]); } catch { return []; } })()), ...process.env };
const key = env.STRIPE_SECRET_KEY || '';
if (!/^sk_(test|live)_/.test(key)) { console.error('STRIPE_SECRET_KEY (sk_test_… or sk_live_…) is not set in .env.local.'); process.exit(1); }
const live = key.startsWith('sk_live_');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const webhookUrl = arg('--webhook-url');
const secretOut = arg('--secret-out');
if (webhookUrl && !secretOut) { console.error('--webhook-url needs --secret-out <file>'); process.exit(1); }
if (webhookUrl && !/^https:\/\/[a-z0-9.-]+\/api\/stripe-webhook(\?x-vercel-protection-bypass=[A-Za-z0-9]+)?$/i.test(webhookUrl)) { console.error('webhook URL must be https://<host>/api/stripe-webhook'); process.exit(1); }
const legalBase = arg('--legal-base');
const downgrades = arg('--downgrades') || 'at-period-end';
if (!['at-period-end', 'immediately'].includes(downgrades)) { console.error('--downgrades must be at-period-end or immediately'); process.exit(1); }
if (legalBase && !/^https:\/\/[a-z0-9.-]+$/i.test(legalBase)) { console.error('--legal-base must be https://<host>'); process.exit(1); }

const stripe = new Stripe(key);
// Stripe Tax product tax code: "Software as a service (SaaS) - personal use" (SparkScribe is sold to individuals)
const TAX_CODE = 'txcd_10103000';
const sbUrl = env.NEXT_PUBLIC_SUPABASE_URL, sbKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const plans = await (await fetch(`${sbUrl}/rest/v1/billing_plans?select=*&tier=not.is.null&order=tier`, { headers: { apikey: sbKey } })).json();
const paid = plans.filter((p) => p.billing_interval);
if (!paid.length) { console.error('No paid plans found in billing_plans.'); process.exit(1); }

console.log(`Stripe ${live ? 'LIVE' : 'TEST'} mode`);
const out = {};
const prices = [];
for (const p of paid) {
  const lookup = `sparkscribe_${p.key}_${p.billing_interval}ly_${p.price_cents}`;
  let price = (await stripe.prices.list({ lookup_keys: [lookup], expand: ['data.product'], limit: 1 })).data[0];
  if (!price) {
    const product = await stripe.products.create({
      name: `SparkScribe ${p.name}`,
      description: `${Math.round(p.monthly_seconds / 3600)} hours of transcription per month`,
      metadata: { sparkscribe_plan: p.key },
      tax_code: TAX_CODE,
    });
    price = await stripe.prices.create({
      product: product.id, currency: p.currency, unit_amount: p.price_cents, tax_behavior: 'exclusive',
      recurring: { interval: p.billing_interval }, lookup_key: lookup, nickname: `SparkScribe ${p.name} monthly`,
      metadata: { sparkscribe_plan: p.key },
    });
    price.product = product;
    console.log(`created ${p.name}: ${product.id} / ${price.id}`);
  } else {
    console.log(`found   ${p.name}: ${price.product.id} / ${price.id}`);
  }
  if (price.unit_amount !== p.price_cents || price.currency !== p.currency) { console.error(`Price mismatch for ${p.key}`); process.exit(1); }
  // Stripe Tax: products are classified as SaaS for personal use; tax is added on top of the listed price
  const productId = typeof price.product === 'string' ? price.product : price.product.id;
  if ((typeof price.product === 'string' ? null : price.product.tax_code?.id ?? price.product.tax_code) !== TAX_CODE) await stripe.products.update(productId, { tax_code: TAX_CODE });
  if (price.tax_behavior === 'unspecified') console.log(`  note: ${p.name} price has no tax behavior; Stripe Tax uses the account default (set it to "exclusive" in Tax settings)`);
  out[`STRIPE_${p.key.toUpperCase()}_PRICE_ID`] = price.id;
  prices.push({ product: productId, prices: [price.id] });

  // introductory price: a coupon worth the difference, on this plan's product only, for the intro months only
  if (p.intro_price_cents != null) {
    const off = p.price_cents - p.intro_price_cents, months = p.intro_months || 1;
    const id = `sparkscribe_${p.key}_intro_${off}_${months}m`;
    const getCoupon = () => stripe.coupons.retrieve(id, { expand: ['applies_to'] }).catch(() => null);
    let coupon = await getCoupon();
    if (!coupon) {
      coupon = await stripe.coupons.create({
        id, name: `${p.name}: first ${months === 1 ? 'month' : `${months} months`} ${(p.intro_price_cents / 100).toFixed(2)} ${p.currency.toUpperCase()}`,
        amount_off: off, currency: p.currency, applies_to: { products: [productId] },
        ...(months === 1 ? { duration: 'once' } : { duration: 'repeating', duration_in_months: months }),
        metadata: { sparkscribe_plan: p.key, sparkscribe_intro: '1' },
      });
      coupon = await getCoupon(); // applies_to is only returned when expanded
      console.log(`created coupon ${id}`);
    } else console.log(`found   coupon ${id}`);
    if (coupon.amount_off !== off || coupon.currency !== p.currency || !coupon.applies_to?.products?.includes(productId) || (months === 1 ? coupon.duration !== 'once' : coupon.duration_in_months !== months)) {
      console.error(`Coupon ${id} doesn't match the plan's introductory price`); process.exit(1);
    }
    out[`STRIPE_${p.key.toUpperCase()}_INTRO_COUPON`] = coupon.id;
  }
}

const portalSpec = {
  business_profile: { headline: 'SparkScribe: manage your plan and billing', ...(legalBase && { terms_of_service_url: `${legalBase}/terms`, privacy_policy_url: `${legalBase}/privacy` }) },
  features: {
    customer_update: { enabled: true, allowed_updates: ['email', 'address'] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none', cancellation_reason: { enabled: true, options: ['too_expensive', 'unused', 'switched_service', 'other'] } },
    subscription_update: {
      enabled: true, default_allowed_updates: ['price'], proration_behavior: 'always_invoice', products: prices,
      // a cheaper plan starts at the next renewal (the customer keeps what they paid for until then)
      ...(downgrades === 'at-period-end' && { schedule_at_period_end: { conditions: [{ type: 'decreasing_item_amount' }] } }),
    },
  },
  metadata: { sparkscribe: 'portal_four_tier', downgrades },
};
const existing = (await stripe.billingPortal.configurations.list({ active: true, limit: 50 })).data.find((c) => c.metadata?.sparkscribe === 'portal_four_tier');
const portal = existing ? await stripe.billingPortal.configurations.update(existing.id, portalSpec) : await stripe.billingPortal.configurations.create(portalSpec);
console.log(`${existing ? 'updated' : 'created'} portal configuration ${portal.id}`);
out.STRIPE_PORTAL_CONFIGURATION_ID = portal.id;

if (webhookUrl) {
  const events = ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
    'customer.subscription.paused', 'customer.subscription.resumed', 'invoice.paid', 'invoice.payment_failed', 'invoice.payment_action_required'];
  const found = (await stripe.webhookEndpoints.list({ limit: 100 })).data.find((w) => w.url === webhookUrl);
  if (found) {
    await stripe.webhookEndpoints.update(found.id, { enabled_events: events });
    console.log(`webhook exists: ${found.id} (its signing secret is only shown once, at creation; delete the endpoint to get a new one)`);
  } else {
    const wh = await stripe.webhookEndpoints.create({ url: webhookUrl, enabled_events: events, api_version: Stripe.API_VERSION, description: `SparkScribe ${live ? 'production' : 'test'} webhook` });
    writeFileSync(secretOut, wh.secret, { mode: 0o600 });
    console.log(`created webhook ${wh.id}; signing secret written to ${secretOut}`);
  }
}

console.log('\nServer environment variables (IDs, not secrets):');
for (const [k, v] of Object.entries(out)) console.log(`${k}=${v}`);
