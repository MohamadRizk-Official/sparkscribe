// Billing operations. Every decision about what a user may do comes from the database (entitlements) and
// Stripe (subscriptions); nothing the browser says about its plan is trusted.
//
//   getStatus()          the signed-in user's plan, usage and renewal (from public.billing_status())
//   authorize()          may this user start transcribing a recording of N seconds? (checked before work starts;
//                        the database re-checks when the transcription is saved)
//   createCheckout()     Stripe Checkout for Free -> Flash/Bolt/Thunder, monthly or yearly; a plan change for paid users
//                        (Customer Portal)
//   createPortal()       Stripe Customer Portal for the signed-in user's own customer
//   handleEvent()        a verified Stripe webhook event -> synchronized subscription state
//   deleteAccount()      stop billing in Stripe, then delete the account (nobody keeps paying for a deleted account)
import { getStripe, isLiveMode, billingDb, loadPlans, priceIdFor, planForPrice, INTERVALS, BillingError, billingLog, paymentsEnabled, assertPaymentsEnabled, portalAllowed, billingConfigured, automaticTax, introCouponFor, billingScope } from './config.js';

const PAID_STATUSES = new Set(['active', 'trialing', 'past_due']);
const ACTIVE = (s) => PAID_STATUSES.has(s.status);
// SparkScribe's own Customer Portal settings (plans, cancellation at period end), if configured
const portalConfig = () => (/^bpc_[A-Za-z0-9]+$/.test(process.env.STRIPE_PORTAL_CONFIGURATION_ID || '') ? { configuration: process.env.STRIPE_PORTAL_CONFIGURATION_ID } : {});
const MAX_SECONDS = 360_000;

export async function getStatus(sb) {
  const { data, error } = await sb.rpc('billing_status');
  if (error || !data) throw new BillingError("Your plan couldn't be loaded. Try again.", { status: 503, code: 'status_unavailable' });
  return data;
}

// ---------- quota ----------
export async function authorize(sb, durationSeconds) {
  const seconds = Number(durationSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_SECONDS) throw new BillingError('Invalid recording length.', { status: 400, code: 'bad_request' });
  const s = await getStatus(sb);
  const plans = await loadPlans();
  const next = plans.find((p) => p.billing_interval && p.monthly_seconds > s.monthlySeconds) || null;
  const base = { plan: s.plan, remainingSeconds: Number(s.remainingSeconds), monthlySeconds: s.monthlySeconds, periodEnd: s.periodEnd, upgradeTo: next?.key || null,
    upgradesAvailable: paymentsEnabled() && !!next && !!priceIdFor(next.key) };
  if (!s.enforced) return { ok: true, enforced: false, ...base };
  // one second of tolerance, matching the database check
  if (seconds > Number(s.remainingSeconds) + 1) {
    billingLog('usage_rejected', { plan: s.plan, requested: Math.round(seconds), remaining: Math.round(Number(s.remainingSeconds)) });
    return { ok: false, enforced: true, reason: Number(s.remainingSeconds) < 1 ? 'limit_reached' : 'too_long', requestedSeconds: seconds, ...base };
  }
  return { ok: true, enforced: true, ...base };
}

// ---------- customer ----------
// One Stripe customer per SparkScribe account. The database keeps the mapping; a concurrent second request
// gets the customer the first one linked, and its own extra customer is removed.
async function ensureCustomer(sb, user) {
  const stripe = getStripe();
  const live = isLiveMode();
  const { data: row } = await sb.from('subscriptions').select('stripe_customer_id, livemode').eq('user_id', user.id).maybeSingle();
  if (row?.stripe_customer_id && row.livemode === live) return row.stripe_customer_id;
  // A test-mode server (a Preview sharing the production database) must never replace a real customer link:
  // that would detach the person's live subscription from their account.
  if (!live && row?.stripe_customer_id && row.livemode === true) {
    throw new BillingError('Test payments are not available for an account with real billing.', { status: 409, code: 'live_account' });
  }
  const created = await stripe.customers.create(
    { email: user.email || undefined, metadata: { supabase_user_id: user.id, sparkscribe_scope: billingScope() } },
    { idempotencyKey: `sparkscribe-customer-${user.id}-${live ? 'live' : 'test'}` },
  );
  const linked = await billingDb().call('billing_link_customer', { p_user: user.id, p_customer: created.id, p_livemode: live });
  if (linked !== created.id) {
    await stripe.customers.del(created.id).catch(() => {});
    return linked;
  }
  billingLog('customer_linked', { user: user.id });
  return linked;
}

// The customer's current subscription that still gives (or is about to give) access, straight from Stripe.
async function liveSubscription(customer) {
  const subs = await getStripe().subscriptions.list({ customer, status: 'all', limit: 10 });
  return subs.data.find((s) => PAID_STATUSES.has(s.status)) || subs.data.find((s) => s.status === 'incomplete') || null;
}

// ---------- Checkout / plan change ----------
export async function createCheckout(sb, user, planKey, origin, interval = 'month') {
  assertPaymentsEnabled(); // before any Stripe or database call
  if (!INTERVALS.includes(interval)) throw new BillingError('Choose monthly or yearly billing.', { status: 400, code: 'bad_interval' });
  const stripe = getStripe();
  const plans = await loadPlans();
  const plan = plans.find((p) => p.key === planKey && p.billing_interval);
  if (!plan) throw new BillingError('Choose Flash, Bolt or Thunder.', { status: 400, code: 'bad_plan' });
  // yearly needs both the yearly price on the site and the matching Stripe price, so the page and the charge agree
  const price = interval === 'year' && !plan.yearly_price_cents ? null : priceIdFor(plan.key, interval);
  if (!price) throw new BillingError(interval === 'year' ? 'Yearly billing isn’t available for this plan yet. Nothing was charged.' : 'This plan is not available yet.', { status: 503, code: 'billing_not_configured' });
  const label = `${plan.name}${interval === 'year' ? ' (yearly)' : ''}`;

  const customer = await ensureCustomer(sb, user);
  const current = await liveSubscription(customer);
  if (current && PAID_STATUSES.has(current.status)) {
    const item = current.items.data[0];
    if (item?.price?.id === price) throw new BillingError(`You're already on ${label}.`, { status: 409, code: 'already_on_plan' });
    // Already paying: change the plan through the Customer Portal, where Stripe shows the prorated amount and
    // the user confirms. No second subscription is ever created. SparkScribe's own portal configuration is required:
    // the account's default one doesn't list these prices, so Stripe would refuse the change.
    if (!portalConfig().configuration) throw new BillingError('Changing plans isn’t available yet. Nothing was charged.', { status: 503, code: 'billing_not_configured' });
    const session = await stripe.billingPortal.sessions.create({
      customer,
      ...portalConfig(),
      return_url: `${origin}/account`,
      flow_data: {
        type: 'subscription_update_confirm',
        subscription_update_confirm: { subscription: current.id, items: [{ id: item.id, price, quantity: 1 }] },
        after_completion: { type: 'redirect', redirect: { return_url: `${origin}/account?changed=1` } },
      },
    });
    billingLog('plan_change_session', { user: user.id, to: plan.key, interval });
    return { url: session.url, kind: 'change' };
  }
  // The introductory price (Flash: $1 for the first month), only on MONTHLY billing and only for an account the database
  // says has never had a paid subscription nor used the offer. Decided here, never by the browser. If the coupon isn't
  // configured the checkout is refused rather than charging a price the page didn't show. Yearly never gets it.
  let coupon = null;
  if (plan.intro_price_cents != null && interval === 'month') {
    const st = await getStatus(sb);
    if (st.introEligible === true) {
      coupon = introCouponFor(plan.key);
      if (!coupon) throw new BillingError('The introductory price isn’t available right now. Nothing was charged. Try again later.', { status: 503, code: 'intro_unavailable' });
    }
  }
  // Checkout pages this customer opened earlier (another tab, a double click) are closed first, so at most one can
  // be paid. Two paid at the same instant are still caught by the webhook (settleDuplicates).
  const open = await stripe.checkout.sessions.list({ customer, status: 'open', limit: 10 }).catch(() => ({ data: [] }));
  for (const s of open.data || []) await stripe.checkout.sessions.expire(s.id).catch(() => {});
  if (current?.status === 'incomplete') {
    // an earlier checkout that never completed payment: let Stripe expire it rather than stacking another
    await stripe.subscriptions.cancel(current.id).catch(() => {});
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    metadata: { supabase_user_id: user.id, plan: plan.key, interval, intro: coupon ? '1' : '0', sparkscribe_scope: billingScope() },
    subscription_data: { metadata: { supabase_user_id: user.id, plan: plan.key, interval, intro: coupon ? '1' : '0', sparkscribe_scope: billingScope() } },
    success_url: `${origin}/account?checkout=success`,
    cancel_url: `${origin}/pricing?checkout=canceled`,
    // the only discount is the server's introductory coupon; customers can't enter codes
    ...(coupon ? { discounts: [{ coupon }] } : { allow_promotion_codes: false }),
    ...(automaticTax() && { automatic_tax: { enabled: true }, billing_address_collection: 'required', customer_update: { address: 'auto', name: 'auto' } }),
  });
  billingLog('checkout_session', { user: user.id, plan: plan.key, interval, intro: Boolean(coupon) });
  return { url: session.url, kind: 'checkout' };
}

// A plan change the customer scheduled in the portal (a downgrade starts at the next renewal): read from Stripe for
// the Account page, so the customer sees it was taken. -> { plan, planName, at } or null
export async function scheduledChange(sb, user) {
  if (!billingConfigured()) return null;
  const { data: row } = await sb.from('subscriptions').select('stripe_subscription_id, livemode, stripe_price_id').eq('user_id', user.id).maybeSingle();
  if (!row?.stripe_subscription_id || row.livemode !== isLiveMode()) return null;
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
  const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule?.id;
  if (!scheduleId || !PAID_STATUSES.has(sub.status)) return null;
  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
  const now = Math.floor(Date.now() / 1000);
  const currentPrice = sub.items.data[0]?.price?.id;
  const next = (schedule.phases || []).find((ph) => ph.start_date > now && ph.items?.[0] && (typeof ph.items[0].price === 'string' ? ph.items[0].price : ph.items[0].price?.id) !== currentPrice);
  if (!next) return null;
  const price = typeof next.items[0].price === 'string' ? next.items[0].price : next.items[0].price?.id;
  const plan = await planForPrice(price);
  if (!plan) return null;
  const p = (await loadPlans()).find((x) => x.key === plan);
  return { plan, planName: p?.name || plan, at: new Date(next.start_date * 1000).toISOString() };
}

export async function createPortal(sb, user, origin) {
  if (!portalAllowed()) throw new BillingError("Billing isn't available yet. Nothing was charged.", { status: 503, code: 'payments_unavailable' });
  const live = isLiveMode();
  const { data: row } = await sb.from('subscriptions').select('stripe_customer_id, livemode').eq('user_id', user.id).maybeSingle();
  if (!row?.stripe_customer_id || row.livemode !== live) throw new BillingError("You don't have billing to manage yet.", { status: 404, code: 'no_billing_account' });
  const session = await getStripe().billingPortal.sessions.create({ customer: row.stripe_customer_id, ...portalConfig(), return_url: `${origin}/account` });
  billingLog('portal_session', { user: user.id });
  return { url: session.url };
}

// ---------- webhooks ----------
const ts = (s) => (s ? new Date(s * 1000).toISOString() : null);
const idOf = (x) => (typeof x === 'string' ? x : x?.id || null);

// Store a subscription exactly as Stripe reports it now (fetched fresh, so late or out-of-order events can't
// leave stale state behind).
// The account always stores the customer's PAYING subscription (the oldest one that still gives access; there is
// only ever one after settleDuplicates), whichever subscription the event was about. Only when none gives access is
// the event's own subscription stored (canceled, incomplete…). So a duplicate's events can never replace or end the
// subscription that is kept, in any order.
async function syncSubscription(subscriptionId) {
  const stripe = getStripe();
  let sub = await stripe.subscriptions.retrieve(subscriptionId);
  const paying = (await stripe.subscriptions.list({ customer: idOf(sub.customer), status: 'all', limit: 20 })).data
    .filter(ACTIVE).sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
  if (paying.length) sub = paying[0];
  const item = sub.items?.data?.[0];
  const price = item?.price?.id || null;
  const plan = await planForPrice(price);
  // a price this server doesn't know grants nothing (stored as Free); raise it for an operator, ids only
  if (price && !plan) console.error(`[billing] ${JSON.stringify({ event: 'unknown_price', alert: true, subscription: sub.id, price, livemode: Boolean(sub.livemode) })}`);
  const metaUser = sub.metadata?.supabase_user_id || null;
  const userId = await billingDb().call('billing_apply_subscription', {
    p_customer: idOf(sub.customer),
    p_meta_user: /^[0-9a-f-]{36}$/i.test(metaUser || '') ? metaUser : null,
    p_subscription: sub.id,
    p_status: sub.status,
    p_plan: plan,
    p_price: price,
    p_livemode: Boolean(sub.livemode),
    p_period_start: ts(item?.current_period_start ?? sub.current_period_start),
    p_period_end: ts(item?.current_period_end ?? sub.current_period_end),
    p_cancel_at_period_end: Boolean(sub.cancel_at_period_end || (sub.cancel_at && sub.cancel_at <= (item?.current_period_end ?? 0))),
    p_cancel_at: ts(sub.cancel_at),
    p_canceled_at: ts(sub.canceled_at),
  });
  return { userId, customer: idOf(sub.customer), subscription: sub.id, plan: plan || 'unknown_price', status: sub.status };
}

// Refund what a subscription was charged (a duplicate, or a payment made for an account that no longer exists).
// `invoice`: refund only that invoice (a renewal charged after the account was deleted); otherwise every paid one.
async function refundSubscription(subscriptionId, reason, invoice = null) {
  const stripe = getStripe();
  const invoices = invoice ? { data: [await stripe.invoices.retrieve(invoice)] } : await stripe.invoices.list({ subscription: subscriptionId, status: 'paid', limit: 10 });
  let refunded = 0;
  for (const inv of invoices.data) {
    if (!inv.amount_paid) continue;
    const payments = await stripe.invoicePayments.list({ invoice: inv.id, limit: 10 });
    for (const p of payments.data) {
      if (p.status !== 'paid') continue;
      const pi = idOf(p.payment?.payment_intent);
      const charge = idOf(p.payment?.charge);
      if (!pi && !charge) continue;
      await stripe.refunds.create({ ...(pi ? { payment_intent: pi } : { charge }), reason: reason === 'duplicate' ? 'duplicate' : 'requested_by_customer', metadata: { sparkscribe_reason: reason } },
        { idempotencyKey: `sparkscribe-refund-${pi || charge}` });
      refunded++;
    }
  }
  return refunded;
}

// One customer, one paying subscription. If two checkouts were paid at the same moment, the newer subscription is
// canceled at once and its payment refunded; the first one stays.
async function settleDuplicates(customer) {
  const stripe = getStripe();
  const subs = (await stripe.subscriptions.list({ customer, status: 'all', limit: 20 })).data.filter(ACTIVE);
  if (subs.length < 2) return 0;
  subs.sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
  for (const extra of subs.slice(1)) {
    await stripe.subscriptions.cancel(extra.id, { prorate: false }, { idempotencyKey: `sparkscribe-dup-cancel-${extra.id}` });
    const refunds = await refundSubscription(extra.id, 'duplicate');
    billingLog('duplicate_subscription_canceled', { customer, subscription: extra.id, kept: subs[0].id, refunds });
    await syncSubscription(extra.id).catch(() => {});
  }
  return subs.length - 1;
}

// A SparkScribe subscription whose account no longer exists (deleted while a Checkout page was still open, or
// removed by an administrator) must not keep charging: it is canceled at once. A payment made after the account
// was gone (a completed Checkout, or a renewal) is refunded too.
async function stopOrphan(subscriptionId, { refund, invoice = null }) {
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  if (!/^[0-9a-f-]{36}$/i.test(sub.metadata?.supabase_user_id || '')) return false; // not created by SparkScribe
  if (!['canceled', 'incomplete_expired'].includes(sub.status)) {
    await stripe.subscriptions.cancel(sub.id, { prorate: false }, { idempotencyKey: `sparkscribe-orphan-cancel-${sub.id}` });
  }
  const refunds = refund ? await refundSubscription(sub.id, 'account_deleted', invoice) : 0;
  billingLog('orphan_subscription_canceled', { subscription: sub.id, refunds });
  return true;
}

// A subscription for a customer the database doesn't know, but whose metadata (written by this server at Checkout)
// names an existing account: link it and sync. Returns null if that account doesn't exist (an orphan).
async function relinkFromMetadata(subscriptionId) {
  const sub = await getStripe().subscriptions.retrieve(subscriptionId);
  const uid = sub.metadata?.supabase_user_id;
  if (!/^[0-9a-f-]{36}$/i.test(uid || '')) return null;
  try {
    const linked = await billingDb().call('billing_link_customer', { p_user: uid, p_customer: idOf(sub.customer), p_livemode: Boolean(sub.livemode) });
    if (linked !== idOf(sub.customer)) return null;
  } catch (e) {
    if (/unknown_user/.test(e.message)) return null;
    throw e;
  }
  return syncSubscription(sub.id);
}

// Outcomes that will never succeed on retry: recorded, acknowledged, and never grant access.
const FINAL_REFUSALS = /unknown_customer|user_mismatch|mode_mismatch|customer_belongs_to_another_user|unknown_user/;

// the deployment that created the object an event is about (see billingScope); null = untagged (older objects)
function scopeOf(obj) {
  return obj?.metadata?.sparkscribe_scope || obj?.parent?.subscription_details?.metadata?.sparkscribe_scope
    || obj?.subscription_details?.metadata?.sparkscribe_scope || null;
}

export async function handleEvent(event) {
  const db = billingDb();
  if (Boolean(event.livemode) !== isLiveMode()) {
    billingLog('webhook_ignored', { id: event.id, type: event.type, reason: 'other_mode' });
    return { status: 200, body: { received: true, ignored: 'other_mode' } };
  }
  const scope = scopeOf(event.data?.object);
  if (scope && scope !== billingScope()) {
    billingLog('webhook_ignored', { id: event.id, type: event.type, reason: 'other_scope' });
    return { status: 200, body: { received: true, ignored: 'other_scope' } };
  }
  const begin = await db.call('billing_event_begin', { p_event_id: event.id, p_type: event.type, p_livemode: Boolean(event.livemode) });
  if (begin !== 'new') {
    billingLog('webhook_duplicate', { id: event.id, type: event.type });
    return { status: 200, body: { received: true, duplicate: true } };
  }
  const obj = event.data?.object || {};
  let out = { result: 'ignored', detail: null, userId: null, customer: idOf(obj.customer), subscription: null };
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        if (obj.mode !== 'subscription' || !obj.subscription) break;
        const uid = obj.client_reference_id || obj.metadata?.supabase_user_id;
        if (!/^[0-9a-f-]{36}$/i.test(uid || '')) throw new Error('user_mismatch: checkout without a user');
        // the customer was linked when Checkout was created; this refuses one linked to a different user
        const linked = await db.call('billing_link_customer', { p_user: uid, p_customer: idOf(obj.customer), p_livemode: Boolean(event.livemode) });
        if (linked !== idOf(obj.customer)) throw new Error('customer_belongs_to_another_user');
        const r = await syncSubscription(idOf(obj.subscription));
        // the introductory offer is used up only when a Checkout that carried it completes AND is paid (a delayed payment
        // method can complete a Checkout unpaid; if it's paid later, the paid plan's history makes the account ineligible)
        let promo = '';
        if (obj.metadata?.intro === '1' && Number(obj.total_details?.amount_discount || 0) > 0 && obj.payment_status === 'paid') {
          promo = ` intro:${await db.call('billing_promo_redeem', { p_user: uid, p_promo: `${obj.metadata?.plan || 'flash'}_intro`, p_livemode: Boolean(event.livemode), p_session: obj.id, p_subscription: idOf(obj.subscription) })}`;
        }
        const extra = await settleDuplicates(idOf(obj.customer));
        out = { ...out, result: 'synced', detail: `${r.plan}/${r.status}${promo}${extra ? ` dup:${extra}` : ''}`, userId: r.userId, subscription: r.subscription };
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed': {
        const r = await syncSubscription(obj.id);
        const extra = event.type === 'customer.subscription.created' || event.type === 'customer.subscription.resumed' ? await settleDuplicates(r.customer) : 0;
        out = { ...out, result: 'synced', detail: `${r.plan}/${r.status}${extra ? ` dup:${extra}` : ''}`, userId: r.userId, subscription: r.subscription };
        break;
      }
      case 'invoice.paid':
      case 'invoice.payment_failed':
      case 'invoice.payment_action_required': {
        const subId = idOf(obj.parent?.subscription_details?.subscription) || idOf(obj.subscription);
        if (!subId) break;
        const r = await syncSubscription(subId);
        out = { ...out, result: event.type === 'invoice.paid' ? 'synced' : 'payment_problem', detail: `${r.plan}/${r.status}`, userId: r.userId, subscription: r.subscription };
        break;
      }
      default:
        break;
    }
  } catch (err) {
    const msg = String(err?.message || 'error');
    let refusal = FINAL_REFUSALS.exec(msg)?.[0];
    // a SparkScribe subscription whose account is gone: stop it instead of only refusing it
    if (refusal === 'unknown_user' || refusal === 'unknown_customer') {
      try {
        const subId = event.type === 'checkout.session.completed' ? idOf(obj.subscription)
          : event.type.startsWith('customer.subscription.') ? obj.id : idOf(obj.parent?.subscription_details?.subscription) || idOf(obj.subscription);
        if (subId) {
          const recovered = refusal === 'unknown_customer' ? await relinkFromMetadata(subId) : null;
          if (recovered) {
            await db.call('billing_event_finish', { p_event_id: event.id, p_result: 'synced', p_detail: `relinked ${recovered.plan}/${recovered.status}`, p_user: recovered.userId, p_customer: recovered.customer, p_subscription: recovered.subscription });
            billingLog('webhook_result', { id: event.id, type: event.type, result: 'synced', detail: 'relinked' });
            return { status: 200, body: { received: true } };
          }
          const paidNow = event.type === 'checkout.session.completed' || event.type === 'invoice.paid';
          if (await stopOrphan(subId, { refund: paidNow, invoice: event.type === 'invoice.paid' ? obj.id : null })) refusal = `${refusal}:stopped`;
        }
      } catch (e2) {
        billingLog('orphan_check_failed', { id: event.id, kind: e2?.type || e2?.name || 'Error' });
        await db.call('billing_event_finish', { p_event_id: event.id, p_result: 'error', p_detail: 'orphan check failed', p_user: null, p_customer: out.customer, p_subscription: out.subscription }).catch(() => {});
        return { status: 500, body: { error: 'processing_failed' } }; // retried by Stripe
      }
    }
    await db.call('billing_event_finish', { p_event_id: event.id, p_result: refusal ? `refused:${refusal}` : 'error', p_detail: refusal || 'processing failed', p_user: null, p_customer: out.customer, p_subscription: out.subscription }).catch(() => {});
    billingLog('webhook_result', { id: event.id, type: event.type, result: refusal ? `refused:${refusal}` : 'error' });
    // a refusal is final (200, no retry); anything else is retried by Stripe
    return refusal ? { status: 200, body: { received: true, refused: refusal } } : { status: 500, body: { error: 'processing_failed' } };
  }
  await db.call('billing_event_finish', { p_event_id: event.id, p_result: out.result, p_detail: out.detail, p_user: out.userId, p_customer: out.customer, p_subscription: out.subscription });
  billingLog('webhook_result', { id: event.id, type: event.type, result: out.result, user: out.userId, detail: out.detail });
  return { status: 200, body: { received: true } };
}

// ---------- account deletion ----------
// Order matters: (1) the database confirms a recent sign-in without deleting anything, (2) every subscription of
// this account is canceled in Stripe immediately and the result synced, (3) the account is deleted, (4) the Stripe
// customer is deleted (its saved cards go with it; invoices stay in Stripe for accounting).
// If Stripe can't be reached, nothing is deleted.
const DONE = new Set(['canceled', 'incomplete_expired']);
export async function deleteAccount(sb, user) {
  const { data: check, error: checkError } = await sb.rpc('account_deletion_check');
  if (checkError) {
    if (checkError.code === 'PGRST202' || checkError.code === '42883') throw new BillingError('Deleting accounts isn’t switched on yet. Nothing was deleted.', { status: 503, code: 'deletion_unavailable' });
    throw new BillingError('Your account couldn’t be deleted, and nothing was removed. Try again.', { status: 503, code: 'deletion_failed' });
  }
  if (check?.reason === 'reauth') return { deleted: false, reason: 'reauth' };

  const { data: row } = await sb.from('subscriptions').select('stripe_customer_id, livemode').eq('user_id', user.id).maybeSingle();
  const customer = row?.stripe_customer_id && billingConfigured() && row.livemode === isLiveMode() ? row.stripe_customer_id : null;
  let canceled = 0;
  if (customer) {
    const stripe = getStripe();
    const subs = await stripe.subscriptions.list({ customer, status: 'all', limit: 20 });
    for (const sub of subs.data) {
      if (DONE.has(sub.status)) continue;
      await stripe.subscriptions.cancel(sub.id, { prorate: false }, { idempotencyKey: `sparkscribe-delete-cancel-${sub.id}` });
      canceled++;
      try { await syncSubscription(sub.id); } catch {
        billingLog('account_delete_failed', { user: user.id, canceled, step: 'sync' });
        throw new BillingError('Your subscription was canceled, but the account couldn’t be deleted. Try again.', { status: 503, code: 'deletion_failed' });
      }
    }
  }
  const { data, error } = await sb.rpc('delete_my_account', { p_confirm: 'DELETE' });
  if (error || !data) {
    billingLog('account_delete_failed', { user: user.id, canceled });
    throw new BillingError(canceled ? 'Your subscription was canceled, but the account couldn’t be deleted. Try again.' : 'Your account couldn’t be deleted, and nothing was removed. Try again.', { status: 503, code: 'deletion_failed' });
  }
  if (data.deleted && customer) await getStripe().customers.del(customer).catch(() => billingLog('customer_delete_failed', { user: user.id }));
  billingLog('account_deleted', { user: user.id, deleted: Boolean(data.deleted), canceled, reason: data.reason || null });
  return data;
}
