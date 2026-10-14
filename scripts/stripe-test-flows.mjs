// Drives real Stripe TEST-mode subscription events for one disposable SparkScribe test account, so the deployed
// webhook, the database and the Account page can be checked end to end without waiting a month.
//
//   node scripts/stripe-test-flows.mjs --customer cus_… <step>
//
// Steps (each one makes Stripe send its normal signed webhooks to the endpoint configured in the dashboard):
//   show         the customer's subscriptions (status, plan price, period end, cancel-at-period-end)
//   subscribe    plus|pro: a subscription paid with Stripe's test card token pm_card_visa (like a completed Checkout)
//   decline      plus|pro: a subscription whose first payment is declined (pm_card_chargeDeclined) -> no access
//   upgrade      switch the active subscription to Pro (prorated)
//   downgrade    switch the active subscription to Plus (prorated)
//   renew        start a new billing period now (an immediate renewal invoice, paid with the saved card)
//   fail-renew   make the saved card fail, then renew -> invoice.payment_failed, subscription past_due
//   fix-card     attach a working test card and pay the open invoice -> active again
//   cancel-end   cancel at period end;  resume  undo that
//   cancel-now   cancel immediately
//
// Refuses anything but an sk_test_ key, and only acts on customers created by SparkScribe (metadata
// supabase_user_id). Reads STRIPE_SECRET_KEY, STRIPE_PLUS_PRICE_ID, STRIPE_PRO_PRICE_ID from the environment or
// .env.local. Never prints a secret.
import Stripe from 'stripe';
import { readFileSync } from 'node:fs';

const env = { ...Object.fromEntries((() => { try { return readFileSync('.env.local', 'utf8').split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()]); } catch { return []; } })()), ...process.env };
const die = (m) => { console.error(m); process.exit(1); };
if (!/^sk_test_/.test(env.STRIPE_SECRET_KEY || '')) die('Only a Stripe TEST key (sk_test_…) is accepted.');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const customerId = arg('--customer');
if (!/^cus_[A-Za-z0-9]+$/.test(customerId || '')) die('--customer cus_… is required');
const rest = process.argv.slice(2).filter((a, i, all) => a !== '--customer' && all[i - 1] !== '--customer');
const [step, planArg] = rest;
const PRICE = { plus: env.STRIPE_PLUS_PRICE_ID, pro: env.STRIPE_PRO_PRICE_ID };

const stripe = new Stripe(env.STRIPE_SECRET_KEY);
const customer = await stripe.customers.retrieve(customerId);
if (customer.deleted) die('That customer was deleted.');
const uid = customer.metadata?.supabase_user_id;
if (!/^[0-9a-f-]{36}$/i.test(uid || '')) die('Not a SparkScribe customer (no supabase_user_id metadata).');

const subs = async () => (await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 })).data;
const current = async () => (await subs()).find((s) => ['active', 'trialing', 'past_due'].includes(s.status)) || die('No active subscription.');
const planOf = (s) => Object.entries(PRICE).find(([, id]) => id === s.items.data[0]?.price?.id)?.[0] || 'unknown';
const useCard = async (token) => {
  const pm = await stripe.paymentMethods.attach(token, { customer: customerId });
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm.id } });
  return pm.id;
};
const show = async () => {
  for (const s of await subs()) {
    const item = s.items.data[0];
    console.log(`${s.id}  ${s.status.padEnd(18)} ${planOf(s).padEnd(7)} period_end ${new Date((item?.current_period_end || 0) * 1000).toISOString()}  cancel_at_period_end=${s.cancel_at_period_end}`);
  }
};

switch (step) {
  case 'show': break;
  case 'subscribe':
  case 'decline': {
    const price = PRICE[planArg] || die('plus or pro');
    const pm = await useCard(step === 'subscribe' ? 'pm_card_visa' : 'pm_card_chargeDeclined');
    const s = await stripe.subscriptions.create({ customer: customerId, items: [{ price }], default_payment_method: pm, payment_behavior: 'allow_incomplete', metadata: { supabase_user_id: uid, plan: planArg } });
    console.log(`subscription ${s.id}: ${s.status}`);
    break;
  }
  case 'upgrade':
  case 'downgrade': {
    const s = await current();
    await stripe.subscriptions.update(s.id, { items: [{ id: s.items.data[0].id, price: PRICE[step === 'upgrade' ? 'pro' : 'plus'] }], proration_behavior: 'always_invoice' }); // like the Customer Portal
    break;
  }
  case 'renew': {
    const s = await current();
    // a new period starts now and is invoiced at once (unused time of the old period is credited)
    await stripe.subscriptions.update(s.id, { billing_cycle_anchor: 'now', proration_behavior: 'always_invoice' });
    break;
  }
  case 'fail-renew': {
    const s = await current();
    const pm = await useCard('pm_card_chargeCustomerFail');
    await stripe.subscriptions.update(s.id, { default_payment_method: pm, billing_cycle_anchor: 'now', proration_behavior: 'always_invoice', payment_behavior: 'allow_incomplete' });
    break;
  }
  case 'fix-card': {
    const s = await current();
    const pm = await useCard('pm_card_visa');
    await stripe.subscriptions.update(s.id, { default_payment_method: pm });
    const open = (await stripe.invoices.list({ subscription: s.id, status: 'open', limit: 5 })).data;
    for (const inv of open) await stripe.invoices.pay(inv.id, { payment_method: pm });
    console.log(`paid ${open.length} open invoice(s)`);
    break;
  }
  case 'cancel-end': await stripe.subscriptions.update((await current()).id, { cancel_at_period_end: true }); break;
  case 'resume': await stripe.subscriptions.update((await current()).id, { cancel_at_period_end: false }); break;
  case 'cancel-now': await stripe.subscriptions.cancel((await current()).id); break;
  default: die('step: show | subscribe plus|pro | decline plus|pro | upgrade | downgrade | renew | fail-renew | fix-card | cancel-end | resume | cancel-now');
}
await show();
