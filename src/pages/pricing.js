// /pricing — the plans, their comparison and the FAQ.
//
// Plans, prices, allowances, introductory prices and what each plan includes come from the database (billing_plans,
// the same rows the server's entitlements use). Upgrading goes through the server (/api/billing), which picks the
// Stripe price itself: this page only sends a plan key. Everything else here is presentation.
import { isConfigured } from '../lib/supabase.js';
import { mountAccountMenu, getSession, esc } from '../lib/account.js';
import { loadPlans, getBillingStatus, startCheckout } from '../lib/billing.js';
import { allowance, money, times, perHour, priceGap, priceLines } from '../lib/pricing-catalog.js';

const $ = (id) => document.getElementById(id);
// VITE_PAID_PLANS=1 only in the build that launches paid plans; until then nothing here can start a payment.
const PAID_PLANS = import.meta.env.VITE_PAID_PLANS === '1';

let session = null;
let status = null;
let busy = null;
let plans = [];

function notice(html, kind = '') {
  const n = $('notice');
  n.className = `bill-notice ${kind}`;
  n.innerHTML = html;
  n.hidden = !html;
}

// ---------- plan identities (presentation only) ----------
const ICON = {
  free: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5Z"/><path d="M18.5 15.5c.25 1.6 1.05 2.4 2.5 2.6-1.45.2-2.25 1-2.5 2.6-.25-1.6-1.05-2.4-2.5-2.6 1.45-.2 2.25-1 2.5-2.6Z"/></svg>',
  flash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2.5 6 13.5h5.5L10 21.5l8-11.5h-5.5z"/><path d="M3 8h2.5M2.5 12H4M19.5 16H21M20 20h1.5"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3 6.5 13h5l-1 8L17.5 11h-5z"/><path d="M4.6 7.5a9 9 0 0 1 3-3.2M19.4 16.5a9 9 0 0 1-3 3.2"/></svg>',
  thunder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 15.5H6a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 16 6.6a4.5 4.5 0 0 1 2 8.9h-1"/><path d="m12.5 11-2.5 4.5h3.5L11 21"/></svg>',
};
const CAP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m2.5 9 9.5-5 9.5 5-9.5 5z"/><path d="M6.5 11.2V16c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-4.8M21.5 9v5"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17.5 19.5 7"/></svg>';

// What each premium capability is, in one line (the plans that include it come from the database)
const FEATURE = {
  focused_review: { name: 'Focused Review', text: 'After a quiz, review the concepts behind your mistakes with the exact lines from the recording, then practise just those.' },
  followup_practice: { name: 'New practice questions', text: 'Fresh, checked questions on the concepts you keep missing.' },
  across_ask: { name: 'Ask across recordings', text: 'One question answered from up to 12 lectures or meetings, every claim linked to its passage.' },
  across_guide: { name: 'Combined study guides', text: 'One study guide from up to 10 recordings: shared themes, where each was taught, how they differ.' },
};

// Each card answers "who is this for, and why choose it". What every plan shares lives once, in "Every plan includes".
const LOOK = {
  free: {
    theme: 'free', line: 'Your first step toward smarter notes.', sub: 'No credit card required',
    who: 'I want to see what SparkScribe can do.',
    items: ['Sign up in seconds with email or Google', 'Summaries, notes, Ask, flashcards and quizzes', 'Keep everything you save'],
    cta: 'Get Started Free',
  },
  flash: {
    theme: 'flash', ribbon: 'Featured Deal', line: 'Turn your recordings into progress.',
    who: 'I record an occasional lecture.',
    items: ['{x:free} Free’s transcription time', 'The full AI study workspace', 'Cancel anytime'],
    cta: 'Choose Flash',
  },
  bolt: {
    theme: 'bolt', badge: 'Best for Students', line: 'Stay ahead of your classes.', who: 'I have classes every week.',
    items: ['Focused Review: practise exactly what you missed', 'Room for weekly lectures and revision', 'Cancel anytime'],
    cta: 'Choose Bolt',
  },
  thunder: {
    theme: 'thunder', line: 'Your recordings, connected.', who: 'I study across many lectures or meetings.',
    items: ['Everything in Bolt', 'Answers and guides saved to your account', 'Lowest price per hour: {ph}'],
    cta: 'Get Thunder',
  },
};
const lookFor = (p, i, list) => LOOK[p.key] || {
  theme: p.billing_interval ? (i === list.length - 1 ? 'thunder' : 'bolt') : 'free',
  line: p.tagline || '', items: [], cta: p.billing_interval ? `Upgrade to ${p.name}` : 'Start free',
};
const byKey = (k) => plans.find((p) => p.key === k);
// the introductory price applies only to customers the server says are eligible (signed out: shown as the offer)
const introFor = (p) => (p.intro && status?.introEligible !== false ? p.intro : null);
const shownPlan = (p) => ({ ...p, intro: introFor(p) });

// ---------- the allowance meter: one block per hour, on the scale of the largest plan ----------
function meter(p) {
  const maxH = Math.max(...plans.map((x) => x.monthly_seconds)) / 3600;
  const h = p.monthly_seconds / 3600;
  const label = `${allowance(p.monthly_seconds).long} a month`;
  if (maxH > 24) return `<div class="pz-meter bar" role="img" aria-label="${esc(label)}"><i style="--f:${(h / maxH).toFixed(3)}"></i></div>`;
  const cells = Array.from({ length: Math.ceil(maxH) }, (_, i) => {
    const fill = Math.max(0, Math.min(1, h - i));
    return `<i class="${fill >= 1 ? 'on' : fill > 0 ? 'part' : ''}" style="--i:${i}${fill > 0 && fill < 1 ? `;--p:${Math.round(fill * 100)}%` : ''}"></i>`;
  }).join('');
  return `<div class="pz-meter" role="img" aria-label="${esc(label)}" style="--n:${Math.ceil(maxH)}">${cells}</div>`;
}

// ---------- buttons ----------
function ctaFor(p, look) {
  const current = status && status.plan === p.key;
  if (current) return '<span class="pz-current">Your current plan</span>';
  if (!p.billing_interval) {
    if (!session) return `<a class="pz-btn" href="/auth?next=${encodeURIComponent('/')}">${esc(look.cta)}</a>`;
    return status && status.plan !== 'free' ? '<span class="pz-note">Included when a paid plan ends</span>' : '<span class="pz-current">Your current plan</span>';
  }
  // paid plans only when this build offers them AND the server says they can be bought (it refuses otherwise anyway)
  if (!PAID_PLANS || (session && !status?.upgradesAvailable)) return '<span class="pz-note">Coming soon</span>';
  const intro = introFor(p);
  const cta = intro ? `Get ${p.name} for ${money(intro.price_cents)}` : look.cta;
  if (!session) return `<a class="pz-btn" href="/auth?next=${encodeURIComponent(`/pricing?plan=${p.key}`)}">${esc(cta)}</a>`;
  const label = status && status.plan !== 'free' ? `Switch to ${p.name}` : cta;
  return `<button class="pz-btn" type="button" data-plan="${esc(p.key)}"${busy ? ' disabled' : ''}>${busy === p.key ? 'Opening secure checkout…' : esc(label)}</button>`;
}

// ---------- cards ----------
function card(p, i) {
  const look = lookFor(p, i, plans);
  const sp = shownPlan(p);
  const free = plans.find((x) => !x.billing_interval);
  const a = allowance(p.monthly_seconds);
  const pl = priceLines(sp);
  const sub = look.sub || (p.billing_interval && !sp.intro ? 'Billed monthly' : pl.note);
  const items = look.items.map((t) => t.replace('{x:free}', free ? times(p, free) : '').replace('{ph}', perHour(p) || ''));
  const flash = byKey('flash');
  let callout = '';
  if (p.key === 'bolt' && flash) {
    callout = `<div class="pz-x"><span class="pz-x-big">${esc(times(p, flash))}</span><span class="pz-x-text"><b>Flash’s transcription time</b><span>Just ${esc(priceGap(p, flash))} more per month than Flash’s regular ${esc(money(flash.price_cents))} price.</span></span></div>`;
  } else if (p.key === 'thunder' && p.features.includes('across_ask')) {
    callout = `<div class="pz-x feature"><span class="pz-x-text"><b>${esc(FEATURE.across_ask.name)}</b><span>${esc(FEATURE.across_ask.text)}</span><span class="pz-x-more">Plus combined study guides from up to 10 recordings.</span></span></div>`;
  } else if (p.key === 'flash' && sp.intro) {
    callout = `<div class="pz-x calm"><span class="pz-x-text"><b>Start for just ${esc(money(sp.intro.price_cents))}</b><span>${esc(allowance(p.monthly_seconds).long)} of transcription and the AI study tools you need.</span></span></div>`;
  } else if (p.key === 'free') {
    callout = '<div class="pz-x calm"><span class="pz-x-text"><b>The real app, not a demo</b><span>Transcribe a recording, then try notes, Ask, flashcards and quizzes on it.</span></span></div>';
  }
  const isCurrent = status && status.plan === p.key;
  return `
  <article class="pz-card t-${look.theme}${isCurrent ? ' is-current' : ''}" aria-labelledby="pz-${esc(p.key)}" style="--d:${i}">
    ${look.ribbon && sp.intro ? `<span class="pz-ribbon">${ICON.flash}${esc(look.ribbon)}</span>` : ''}
    ${look.badge ? `<span class="pz-badge">${CAP}${esc(look.badge)}</span>` : ''}
    <header class="pz-head">
      <span class="pz-ic">${ICON[look.theme] || ICON.bolt}</span>
      <h3 id="pz-${esc(p.key)}">${esc(p.name)}</h3>
    </header>
    ${look.line ? `<p class="pz-line">${esc(look.line)}</p>` : ''}
    <div class="pz-price">
      <span class="pz-amt">${esc(pl.amount)}</span><span class="pz-per">${esc(pl.per)}</span>
    </div>
    <p class="pz-then${sp.intro ? ' strong' : ''}">${esc(sub || '')}</p>
    <div class="pz-allow">
      <p class="pz-allow-top"><span class="pz-num">${esc(a.num)}</span><span class="pz-unit">${esc(a.unit)}</span><span class="pz-of">of transcription a month</span></p>
      ${meter(p)}
    </div>
    ${callout}
    ${look.who ? `<p class="pz-who"><span class="sr-only">Who it’s for: </span>“${esc(look.who)}”</p>` : ''}
    ${items.length ? `<ul class="pz-list">${items.map((t) => `<li>${CHECK}<span>${esc(t)}</span></li>`).join('')}</ul>` : ''}
    <div class="pz-cta">${ctaFor(p, look)}</div>
    ${pl.renewal ? `<p class="pz-renew">${esc(pl.renewal)} Cancel anytime.</p>` : '<p class="pz-renew">No payment details needed.</p>'}
  </article>`;
}

function renderCards() {
  $('plans').innerHTML = plans.map(card).join('');
  $('plans').removeAttribute('aria-busy');
  $('plans').querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', () => upgrade(b.dataset.plan)));
  const maxH = Math.max(...plans.map((x) => x.monthly_seconds)) / 3600;
  $('legend').hidden = maxH > 24;
  const paid = plans.some((p) => p.billing_interval);
  $('disclose').hidden = !paid;
  const flash = byKey('flash'), intro = flash && introFor(flash);
  $('disclose').innerHTML = `Prices in US dollars. ${intro ? `The ${esc(money(intro.price_cents))} Flash price is for your first month only, for new subscribers; Flash then renews at ${esc(money(flash.price_cents))}/month. ` : ''}Paid plans renew every month until you cancel. Cancel anytime in Plan &amp; usage and keep your plan until the end of the period you’ve paid for. Any applicable tax is shown at checkout before you pay. Under 18? A parent or guardian must buy a paid plan. <a href="/terms">Terms of Service</a>`;
}

// ---------- Flash or Bolt? (the 3× comparison, regular prices only) ----------
function renderWhy() {
  const flash = byKey('flash'), bolt = byKey('bolt');
  const el = $('why');
  if (!flash || !bolt) { el.hidden = true; return; }
  const groups = Math.round(bolt.monthly_seconds / flash.monthly_seconds);
  const hf = flash.monthly_seconds / 3600;
  const blocks = (n) => Array.from({ length: n }, () => '<i></i>').join('');
  const group = `<span class="pz-grp">${blocks(hf)}</span>`;
  const intro = introFor(flash);
  el.innerHTML = `
    <div class="pz-why-text">
      <p class="pz-kicker mono">Flash or Bolt?</p>
      <h2 id="whyTitle">Bolt gives you <span class="pz-grad-bolt">${esc(times(bolt, flash))}</span> the transcription time of Flash.</h2>
      <p>${esc(allowance(bolt.monthly_seconds).long)} a month instead of ${esc(allowance(flash.monthly_seconds).long)}, plus Focused Review, for ${esc(priceGap(bolt, flash))} more than Flash’s regular ${esc(money(flash.price_cents))}.</p>
    </div>
    <div class="pz-why-vis" role="img" aria-label="${esc(`Flash: ${allowance(flash.monthly_seconds).long} a month for ${money(flash.price_cents)} a month${intro ? ' after the first month' : ''}. Bolt: ${allowance(bolt.monthly_seconds).long} a month for ${money(bolt.price_cents)} a month, ${times(bolt, flash)} as much.`)}">
      <div class="pz-why-row t-flash">
        <span class="pz-why-name">Flash</span>
        <span class="pz-blocks">${group}</span>
        <span class="pz-why-num"><b>${esc(allowance(flash.monthly_seconds).long)}</b><span>${esc(money(flash.price_cents))}/mo · ${esc(perHour(flash))}/hour</span></span>
      </div>
      <div class="pz-why-row t-bolt">
        <span class="pz-why-name">Bolt</span>
        <span class="pz-blocks">${Array.from({ length: groups }, () => group).join('')}</span>
        <span class="pz-why-num"><b>${esc(allowance(bolt.monthly_seconds).long)}</b><span>${esc(money(bolt.price_cents))}/mo · ${esc(perHour(bolt))}/hour</span></span>
      </div>
      <p class="pz-why-foot">Regular monthly prices.${intro ? ` Flash’s first month is ${esc(money(intro.price_cents))} for new subscribers.` : ''}</p>
    </div>`;
  el.hidden = false;
}

// ---------- comparison: the meaningful differences ----------
function renderCompare() {
  const flash = byKey('flash');
  const yes = `<span class="pz-yes">${CHECK}<span class="sr-only">Included</span></span>`;
  const dash = '<span class="pz-na"><span aria-hidden="true">—</span><span class="sr-only">Not included</span></span>';
  const has = (cap) => (p) => (p.features.includes(cap) ? yes : dash);
  const rows = [
    ['Monthly price', (p) => { const i = introFor(p); return i ? `<b>${esc(money(p.price_cents))}</b><small>${esc(money(i.price_cents))} first month</small>` : `<b>${esc(money(p.price_cents))}</b>`; }],
    ['Transcription each month', (p) => `<b>${esc(allowance(p.monthly_seconds).long)}</b>`],
    ['Compared with Flash', (p) => (flash && p.billing_interval && p.key !== 'flash' ? `<b class="pz-ratio">${esc(times(p, flash))}</b>` : p.key === 'flash' ? '<span class="pz-muted">1×</span>' : dash)],
    ['Price per hour of transcription', (p) => (perHour(p) ? esc(perHour(p)) : dash), 'Regular monthly price'],
    ['Summaries, notes, Ask, flashcards, quizzes, study guides', () => yes, 'On one recording at a time'],
    ...['focused_review', 'across_ask', 'across_guide'].filter((c) => plans.some((p) => p.features.includes(c))).map((c) => [FEATURE[c].name, has(c), FEATURE[c].text]),
    ['Cancel anytime', (p) => (p.billing_interval ? yes : dash)],
  ];
  const cls = (p) => `t-${lookFor(p, plans.indexOf(p), plans).theme}`;
  $('compareTable').innerHTML = `
    <table class="pz-table" role="table">
      <caption class="sr-only">Plan comparison</caption>
      <thead role="rowgroup"><tr role="row"><td class="pz-corner" role="cell"></td>${plans.map((p) => `<th scope="col" role="columnheader" class="${cls(p)}"><span class="pz-th"><span class="pz-dot" aria-hidden="true"></span>${esc(p.name)}</span></th>`).join('')}</tr></thead>
      <tbody role="rowgroup">${rows.map(([label, f, hint]) => `<tr role="row"><th scope="row" role="rowheader">${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</th>${plans.map((p) => `<td role="cell" class="${cls(p)}" data-plan="${esc(p.name)}">${f(p)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
    <p class="pz-fine">Every plan gives the same transcription accuracy and the same quality of AI answers. AI features have fair-use limits per account, and paid plans have higher limits; when you reach one, SparkScribe tells you when you can continue.</p>`;
  $('compare').hidden = false;
}

// ---------- FAQ (answers describe how SparkScribe works today; plan-specific ones appear only for those plans) ----------
function renderFaq() {
  const flash = byKey('flash'), bolt = byKey('bolt'), thunder = byKey('thunder');
  const fr = plans.filter((p) => p.features.includes('focused_review')).map((p) => p.name).join(' and ');
  const ax = plans.filter((p) => p.features.includes('across_ask')).map((p) => p.name).join(' and ');
  const intro = flash && introFor(flash);
  const qa = [
    ['What counts toward transcription time?', 'The length of the recordings you transcribe and save to your library. Opening recordings, searching and exports never use your time. AI features (summaries, notes, Ask, Create tools) don’t use transcription time either; they have their own fair-use limits, and the app tells you if you reach one.'],
    ['Does unused time roll over?', 'No. Your transcription time resets every month: the Free plan on the 1st (UTC), paid plans when your subscription renews. Unused time doesn’t carry over.'],
    ['What happens when I reach my limit?', 'SparkScribe checks before it starts. If a recording is longer than the time you have left, it tells you and uses none of your time. Everything already in your library stays available, your time resets at the start of your next month or billing period, and you can upgrade at any time.'],
    fr && ['What is Focused Review?', `${FEATURE.focused_review.text} When a concept needs more practice, ${fr} can also write new questions on it, checked against the recording like every quiz question. Every plan keeps quiz difficulty, exam focus, per-question review and retakes.`],
    ax && ['What does asking across recordings do?', `With ${ax}, you choose 2 to 12 saved recordings and ask one question about all of them: what changed between lectures, which decisions came up in several meetings, what every lecture repeated. Each point names the recording it comes from and links to the exact passage; if the recordings don’t answer the question, it says so. You can also make one combined study guide from up to 10 recordings. Answers and guides are saved to your account, so you can reopen them on any device.`],
    ['Can I upgrade later?', 'Yes, whenever you like. An upgrade takes effect right away: you get the higher plan’s monthly time and features, and you pay only the prorated difference for the rest of your current billing period.'],
    ['Can I cancel anytime?', 'Yes, in Plan & usage → Manage billing. Your plan stays active until the end of the period you’ve paid for, then you move to the Free plan. No further payments are taken, and nothing in your library is deleted.'],
    intro && [`How does the ${money(intro.price_cents)} Flash offer work?`, `If you’ve never had a paid SparkScribe plan, your first month of Flash costs ${money(intro.price_cents)}. From your second month, Flash renews at ${money(flash.price_cents)} a month until you cancel. Checkout shows both prices before you pay.`],
    intro && [`Will Flash renew at ${money(flash.price_cents)}?`, `Yes. After the first month, Flash renews automatically at ${money(flash.price_cents)} a month until you cancel. If you cancel during your first month, you keep Flash until that month ends and you aren’t charged again.`],
    flash && bolt && ['What’s the difference between Flash and Bolt?', `Flash gives you ${allowance(flash.monthly_seconds).long} of transcription a month and the full AI study workspace. Bolt gives you ${allowance(bolt.monthly_seconds).long}, ${times(bolt, flash)} as much, plus Focused Review, for ${money(bolt.price_cents)} a month: ${priceGap(bolt, flash)} more than Flash’s regular price. Bolt is made for people who record classes every week.`],
    thunder && ['Is Thunder suitable for long lectures?', `Yes. Thunder includes ${allowance(thunder.monthly_seconds).long} of transcription a month for heavy schedules. On every plan, a single recording can be as long as the time you have left. Files larger than 4 GB need to be converted to audio first, and how fast a long recording transcribes depends on your device.`],
    ['What happens to my work if I downgrade?', `Everything you saved stays: recordings, notes, quizzes, review progress${ax ? ', and the answers and study guides you made across recordings (you can still open them)' : ''}. A lower plan limits how much new audio you can transcribe each month${fr ? `, and creating new Focused Review practice${ax ? ' or new answers across recordings' : ''} needs the plan that includes it again` : ''}.`],
    ['What leaves my device?', 'Never your audio: transcription runs on your device. Transcripts you save are stored privately in your account, and when you use an AI feature only the transcript text it needs is sent to our AI provider, Anthropic. Payments are handled by Stripe; SparkScribe never sees your card.'],
  ].filter(Boolean);
  $('faqList').innerHTML = qa.map(([q, a]) => `<details class="faq-item"><summary><span>${esc(q)}</span><span class="faq-ic" aria-hidden="true"></span></summary><div class="faq-a"><p>${esc(a)}</p></div></details>`).join('');
}

async function upgrade(plan) {
  if (busy) return;
  busy = plan;
  renderCards();
  notice('');
  try {
    await startCheckout(plan); // navigates to Stripe
  } catch (err) {
    busy = null;
    renderCards();
    notice(esc(err.message || "Checkout couldn't be opened. Nothing was charged. Try again."), 'bad');
  }
}

async function main() {
  if (isConfigured) mountAccountMenu($('accountSlot'));
  const q = new URLSearchParams(location.search);
  // came from a feature that needs a plan (e.g. /across with a selection): remember where to return after upgrading
  const next = q.get('next') || '';
  if (/^\/(?!\/)[\w\-./?=&%,]*$/.test(next)) { try { sessionStorage.setItem('sparkscribe.afterUpgrade', next); } catch {} }
  if (q.get('checkout') === 'canceled') notice('Checkout canceled. Nothing was charged and your plan hasn’t changed.');
  try { plans = await loadPlans(); } catch { plans = []; }
  if (!plans.length) {
    $('plans').innerHTML = '<p class="bill-error">Plans couldn’t be loaded. <a href="/pricing">Refresh</a> to try again.</p>';
    $('plans').removeAttribute('aria-busy');
    return;
  }
  session = await getSession();
  if (session) {
    try { status = await getBillingStatus(); } catch { status = null; }
    if (status?.testMode) notice('<b>Test mode.</b> Stripe test payments only: no real card is charged.', 'test');
    // a plan outside the current lineup (an earlier plan) stays exactly as it is
    if (status && status.plan !== 'free' && !byKey(status.plan)) notice(`You’re on ${esc(status.planName || status.plan)}, an earlier plan. It stays exactly as it is until you change it.`);
  }
  // the footer mirrors the same state: Stripe is only mentioned once plans can actually be bought
  if (PAID_PLANS && (!session || status?.upgradesAvailable)) $('billFoot').textContent = 'Monthly plans · secure payments by Stripe';
  if (!PAID_PLANS || (session && !status?.upgradesAvailable)) notice('<b>Paid plans are coming soon.</b> The Free plan is available today. Nothing on this page can charge you.');
  renderCards();
  renderWhy();
  renderCompare();
  renderFaq();
  // back from signing in after choosing a plan (or from a feature that needs one): continue to checkout
  const wanted = q.get('plan');
  if (PAID_PLANS && status?.upgradesAvailable && session && wanted && plans.some((p) => p.key === wanted && p.billing_interval) && status?.plan === 'free') upgrade(wanted);
  else if (wanted && byKey(wanted)) document.getElementById(`pz-${wanted}`)?.closest('.pz-card')?.classList.add('is-selected');
}
main();
