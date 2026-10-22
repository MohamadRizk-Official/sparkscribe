// /account — current plan, this period's transcription usage, renewal / cancellation date, upgrade and
// Manage Billing. Everything shown comes from the server (billing_status); after Checkout the page waits for
// Stripe's webhook to confirm the subscription instead of assuming the payment worked.
import { isConfigured } from '../lib/supabase.js';
import { mountAccountMenu, requireUser, esc } from '../lib/account.js';
import { loadPlans, getBillingStatus, startCheckout, openPortal, price, perInterval, allowanceLabel, usageParts, usageLevel, durationText, dateText } from '../lib/billing.js';
import { money, hasYearly, yearlySavings } from '../lib/pricing-catalog.js';

// what a premium capability is called on this page
const FEATURE_NAME = { focused_review: 'Focused Review', across_ask: 'Ask across recordings', across_guide: 'Combined study guides' };

const $ = (id) => document.getElementById(id);
let plans = [];
let status = null;
let busy = '';

function notice(html, kind = '') {
  const n = $('notice');
  n.className = `bill-notice ${kind}`;
  n.innerHTML = html;
  n.hidden = !html;
}

export function meterHtml(s) {
  const p = usageParts(Number(s.usedSeconds), s.monthlySeconds);
  const pct = Math.min(100, (Number(s.usedSeconds) / s.monthlySeconds) * 100);
  const level = usageLevel(Number(s.usedSeconds), s.monthlySeconds);
  return `<div class="meter ${level}" role="meter" aria-valuemin="0" aria-valuemax="${s.monthlySeconds}" aria-valuenow="${Math.round(Number(s.usedSeconds))}" aria-label="Transcription used this period">
      <div class="meter-bar"><span style="width:${pct.toFixed(1)}%"></span></div>
      <div class="meter-text"><b>${esc(p.used)} / ${esc(p.total)} ${esc(p.unit)}</b><span>${esc(durationText(Number(s.remainingSeconds)))} left</span></div>
    </div>`;
}

// A canceled subscription that hasn't ended yet: a neutral notice built from the billing status the server read from
// Stripe (plan, end date, allowance, included features) and the Free plan from billing_plans. Display only: nothing
// here changes the subscription.
function cancelNotice(s, plan, features, end) {
  const free = plans.find((p) => p.is_default);
  const keeps = [`${allowanceLabel(s.monthlySeconds)} of transcription a month`, ...features.map((f) => FEATURE_NAME[f])];
  const list = keeps.length > 1 ? `${keeps.slice(0, -1).join(', ')} and ${keeps[keeps.length - 1]}` : keeps[0];
  return `<div class="bill-alert is-ending" role="status">
      <span class="ba-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg></span>
      <div class="ba-body"><b class="ba-title">${esc(plan.name)} ends ${dateText(end)}</b>
        <p>Your subscription won’t renew. Until then you keep ${esc(list)}. After that you’re on ${esc(free?.name || 'Free')}${free ? ` (${esc(allowanceLabel(free.monthly_seconds))} a month)` : ''}. Nothing in your library is removed.</p>
        ${s.hasBillingAccount ? `<p class="ba-next">Changed your mind? Keep ${esc(plan.name)} or change plans in Manage Billing.</p>` : ''}</div>
    </div>`;
}

function render() {
  const s = status;
  const plan = plans.find((p) => p.key === s.plan) || { name: s.planName, price_cents: 0, tier: null, features: s.features || [] };
  const paid = s.plan !== 'free';
  // yearly: the subscription renews once a year (renewsAt) while the transcription time renews monthly (periodEnd)
  const yearly = paid && s.billingInterval === 'year';
  const subEnd = (paid && s.renewsAt) || s.periodEnd;
  const period = paid && !yearly ? 'billing period' : 'month';
  // every higher plan in the lineup is an upgrade path; the next one is offered first
  const tier = plan.tier ?? -1;
  const higher = plans.filter((p) => p.billing_interval && (p.tier ?? -1) > tier);
  const next = higher[0] || null;
  const features = (s.features || []).filter((f) => FEATURE_NAME[f]);
  const level = usageLevel(Number(s.usedSeconds), s.monthlySeconds);
  let when;
  if (!paid) when = `Resets ${dateText(s.periodEnd)}`;
  else if (s.cancelAtPeriodEnd) when = `Your ${esc(plan.name)} plan remains active until ${dateText(subEnd)}`;
  else if (s.scheduledChange) when = `Switches to ${esc(s.scheduledChange.planName)} on ${dateText(s.scheduledChange.at)}. Until then you keep ${esc(plan.name)}.`;
  else if (yearly) when = `Billed yearly · renews ${dateText(subEnd)}. Your transcription time renews ${dateText(s.periodEnd)}.`;
  else when = `Renews ${dateText(s.periodEnd)}`;

  const warn = s.paymentProblem
    ? `<div class="bill-alert bad"><b>We couldn't process your payment.</b> ${paid ? `Your ${esc(plan.name)} plan stays active while Stripe retries.` : 'Your paid plan is paused until the payment goes through.'} Update your payment method in Manage Billing. Your recordings and everything you created are safe.</div>`
    : s.cancelAtPeriodEnd ? cancelNotice(s, plan, features, subEnd) : '';
  const limitMsg = level === 'high' && next
    ? `<p class="meter-hint">${Number(s.remainingSeconds) < 1 ? `You've used your ${esc(allowanceLabel(s.monthlySeconds))} for this ${period}.` : 'You’re almost out of transcription time.'} <b>${esc(next.name)}</b> includes ${esc(allowanceLabel(next.monthly_seconds))} a month.</p>`
    : level === 'warn' && next ? `<p class="meter-hint">You’ve used most of this ${period === 'month' ? 'month' : 'period'}’s time.</p>` : '';

  // a yearly subscriber moves up within yearly billing; everyone else sees monthly prices (with the $1 offer if eligible)
  const priceOf = (p) => (yearly && hasYearly(p) ? `${money(p.yearly_price_cents)}/year`
    : p.intro && !paid && s.introEligible !== false ? `${money(p.intro.price_cents)} first month, then ${price(p)}${perInterval(p)}` : `${price(p)}${perInterval(p)}`);
  const upInterval = yearly ? 'year' : 'month';
  const canUp = yearly ? s.yearlyAvailable : s.upgradesAvailable;
  const upgradeBtn = next && canUp && !s.cancelAtPeriodEnd
    ? `<button class="btn btn-primary" type="button" data-up="${esc(next.key)}" data-interval="${upInterval}"${busy ? ' disabled' : ''}>${busy === next.key ? 'Opening…' : `${paid ? 'Switch' : 'Upgrade'} to ${esc(next.name)} · ${esc(priceOf(next))}`}</button>`
    : '';
  // a monthly subscriber can move the same plan to yearly billing (confirmed in Stripe's portal, prorated there)
  const toYearly = paid && !yearly && hasYearly(plan) && s.yearlyAvailable && !s.cancelAtPeriodEnd
    ? `<button class="btn btn-ghost" type="button" data-up="${esc(plan.key)}" data-interval="year"${busy ? ' disabled' : ''}>${busy === plan.key ? 'Opening…' : `Switch to yearly · ${esc(money(plan.yearly_price_cents))}/year, save ${esc(money(yearlySavings(plan)))}`}</button>`
    : '';
  const included = features.length
    ? `<ul class="acct-feats" aria-label="Included with ${esc(plan.name)}">${features.map((f) => `<li>${esc(FEATURE_NAME[f])}</li>`).join('')}</ul>`
    : '<p class="acct-fine">Includes the AI study workspace: summaries, notes, Ask, flashcards, quizzes and study guides.</p>';
  const paths = higher.length
    ? `<div class="panel acct-card"><div class="ins-label">${paid ? 'Other plans' : 'Upgrade'}</div><ul class="acct-paths">${higher.map((p) => `<li><b>${esc(p.name)}</b><span>${esc(allowanceLabel(p.monthly_seconds))} a month${(p.features || []).filter((f) => FEATURE_NAME[f] && !(s.features || []).includes(f)).map((f) => ` · ${esc(FEATURE_NAME[f])}`).join('')}</span><span class="mono">${esc(priceOf(p))}</span></li>`).join('')}</ul><a class="btn btn-ghost btn-sm" href="/pricing">See what each plan includes</a></div>`
    : '';
  const manage = s.hasBillingAccount
    ? `<button class="btn ${paid ? 'btn-primary' : 'btn-ghost'}" type="button" data-act="portal"${busy ? ' disabled' : ''}>${busy === 'portal' ? 'Opening…' : 'Manage Billing'}</button>` : '';

  if (s.upgradesAvailable || s.hasBillingAccount) $('acctFoot').textContent = 'Payments are handled by Stripe · SparkScribe never sees your card · audio is never uploaded';
  $('account').innerHTML = `
    ${warn}
    <div class="panel acct-card">
      <div class="ins-label">Current plan</div>
      <div class="acct-plan"><h2>${esc(plan.name)}</h2>${!paid ? '' : `<span class="acct-price">${yearly && hasYearly(plan) ? `${esc(money(plan.yearly_price_cents))}/year` : `${esc(price(plan))}${esc(perInterval(plan))}`}</span>`}</div>
      <p class="acct-when">${when}</p>
      <p class="acct-allow"><b>${esc(allowanceLabel(s.monthlySeconds))}</b> of transcription a ${period}</p>
      ${included}
      <div class="acct-actions">${s.paymentProblem ? manage + upgradeBtn : upgradeBtn + manage}${toYearly}<a class="btn btn-ghost" href="/pricing">Compare plans</a></div>
    </div>
    <div class="panel acct-card">
      <div class="ins-label">Transcription this ${period}</div>
      ${meterHtml(s)}
      ${limitMsg}
      <p class="acct-fine">Counts the length of recordings you transcribe. Summaries, notes, Ask, study tools, exports and opening old recordings don’t use time. ${s.meteringStarted ? '' : 'Usage tracking starts when plans launch; recordings you already have are never counted.'}</p>
    </div>
    ${paths}
    ${s.testMode ? '<p class="acct-fine test">Test mode: Stripe test payments only. No real card is charged.</p>' : ''}`;
  $('account').querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => act(b.dataset.up, () => startCheckout(b.dataset.up, b.dataset.interval || 'month'))));
  $('account').querySelector('[data-act="portal"]')?.addEventListener('click', () => act('portal', openPortal));
}

async function act(name, fn) {
  if (busy) return;
  busy = name;
  render();
  try { await fn(); } catch (err) {
    busy = '';
    render();
    notice(esc(err.message || 'That didn’t work. Nothing was charged. Try again.'), 'bad');
  }
}

// After Checkout: wait for the webhook to confirm (never assume success from the return URL alone).
async function waitForActivation(before) {
  $('account').innerHTML = '<div class="panel acct-card activating"><span class="spin" aria-hidden="true"></span><div><b>Activating your subscription…</b><p>This usually takes a few seconds.</p></div></div>';
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, i < 5 ? 1500 : 3000));
    try {
      const s = await getBillingStatus();
      if (s.plan !== before) return s;
    } catch { /* keep waiting */ }
  }
  return null;
}

async function main() {
  if (isConfigured) mountAccountMenu($('accountSlot'));
  await requireUser();
  const q = new URLSearchParams(location.search);
  try {
    plans = await loadPlans();
    status = await getBillingStatus({ detail: true });
  } catch (err) {
    $('account').innerHTML = `<p class="bill-error">${esc(err.message || 'Your plan couldn’t be loaded.')} <a href="/account">Try again</a></p>`;
    return;
  }
  if (q.get('checkout') === 'success') {
    history.replaceState(null, '', '/account');
    if (status.plan === 'free') {
      const s = await waitForActivation(status.plan);
      let back = null;
      try { back = sessionStorage.getItem('sparkscribe.afterUpgrade'); sessionStorage.removeItem('sparkscribe.afterUpgrade'); } catch {}
      const cont = back && /^\/(?!\/)/.test(back) ? ` <a href="${esc(back)}">Continue where you left off</a>` : '';
      if (s) { status = s; notice(`You're on <b>${esc(s.planName)}</b>. Thanks for subscribing!${cont}`, 'ok'); }
      else notice('Your payment is being confirmed. It can take a minute; refresh this page shortly. You won’t be charged twice.', 'warn');
    } else notice(`You're on <b>${esc(status.planName)}</b>.`, 'ok');
  } else if (q.get('changed') === '1') {
    history.replaceState(null, '', '/account');
    notice('Your plan change is being applied. It can take a few seconds to show here.', 'ok');
    setTimeout(async () => { try { status = await getBillingStatus(); render(); } catch {} }, 4000);
  }
  render();
}
main();
