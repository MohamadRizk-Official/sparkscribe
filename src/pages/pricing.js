// /pricing — the plans, their comparison and the FAQ.
//
// Plans, prices, allowances, introductory prices and what each plan includes come from the database (billing_plans,
// the same rows the server's entitlements use). Upgrading goes through the server (/api/billing), which picks the
// Stripe price itself: this page only sends a plan key. Everything else here is presentation.
import { isConfigured } from '../lib/supabase.js';
import { mountAccountMenu, getSession, esc } from '../lib/account.js';
import { loadPlans, getBillingStatus, startCheckout } from '../lib/billing.js';
import { allowance, money, times, perHour, priceGap, priceLines, hasYearly, yearlySavings, yearlyPriceLines } from '../lib/pricing-catalog.js';

const $ = (id) => document.getElementById(id);
// VITE_PAID_PLANS=1 only in the build that launches paid plans; until then nothing here can start a payment.
const PAID_PLANS = import.meta.env.VITE_PAID_PLANS === '1';

let session = null;
let status = null;
let busy = null;
let plans = [];
// Monthly or yearly prices on the cards (?billing=year). Yearly is offered only when every paid plan has a yearly price.
let interval = new URLSearchParams(location.search).get('billing') === 'year' ? 'year' : 'month';
const yearlyShown = () => plans.some((p) => p.billing_interval) && plans.filter((p) => p.billing_interval).every(hasYearly);
const yearly = () => interval === 'year' && yearlyShown();

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
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17.5 19.5 7"/></svg>';

// What each premium capability is, in one line (the plans that include it come from the database)
const FEATURE = {
  focused_review: { name: 'Focused Review', text: 'After a quiz, review the concepts behind your mistakes with the exact lines from the recording, then practise just those.' },
  followup_practice: { name: 'New practice questions', text: 'Fresh, checked questions on the concepts you keep missing.' },
  across_ask: { name: 'Ask across recordings', text: 'One question answered from up to 12 lectures or meetings, every claim linked to its passage.' },
  across_guide: { name: 'Combined study guides', text: 'One study guide from up to 10 recordings: shared themes, where each was taught, how they differ.' },
};

// Each card answers "who is this for, and why choose it", as one progression: Flash makes a single lecture useful,
// Bolt keeps up with weekly classes and fixes what you miss, Thunder connects recordings. What every plan shares lives
// once, in "Every plan includes". Only real capabilities (billing_plans.features and allowances); prices come from the
// database.
const LOOK = {
  free: {
    theme: 'free', tag: 'Start here', line: 'Try the real app, free.', sub: 'No credit card required',
    best: 'trying it on a real lecture',
    items: ['Sign up in seconds with email or Google', 'Summaries, notes, Ask, flashcards and quizzes', 'Keep everything you save'],
    cta: 'Get Started Free',
  },
  flash: {
    theme: 'flash', tag: 'Best low-cost upgrade', line: 'Turn any lecture into notes and practice.',
    best: 'a lecture now and then',
    items: ['{x:free} Free’s transcription time', 'Notes, flashcards and quizzes for each lecture', 'Cancel anytime'],
    cta: 'Choose Flash',
  },
  bolt: {
    theme: 'bolt', tag: 'Great for regular studying', line: 'Keep up every week, and fix what you miss.',
    best: 'classes every week',
    items: ['Focused Review: practise exactly what you missed', '{x:flash} Flash’s transcription time', 'Cancel anytime'],
    cta: 'Choose Bolt',
  },
  thunder: {
    theme: 'thunder', tag: 'Most powerful', line: 'Connect your lectures across the semester.',
    best: 'many courses and exams',
    items: ['Everything in Bolt, including Focused Review', 'Answers and guides saved to your account', 'Lowest price per hour: {ph}'],
    cta: 'Get Thunder',
  },
};
// one decorative effect per tier, drawn once and only played on hover/focus (CSS): Flash ignites, Bolt's current
// runs along a power track, Thunder's arcs strike across the card
const FX = {
  flash: '<svg class="fx-flash" viewBox="0 0 120 40" aria-hidden="true"><path class="g" d="M2 30h22l8-14 9 20 8-26 8 18h61"/><path d="M2 30h22l8-14 9 20 8-26 8 18h61"/></svg>',
  bolt: '<svg class="fx-bolt" viewBox="0 0 300 6" preserveAspectRatio="none" aria-hidden="true"><path d="M0 3h300"/></svg>',
  thunder: '<svg class="fx-thunder" viewBox="0 0 300 120" preserveAspectRatio="none" aria-hidden="true"><path class="g" d="M-4 86 44 70l18 22 36-50 28 34 30-42 26 30 40-48 26 36 36-26"/><path d="M-4 86 44 70l18 22 36-50 28 34 30-42 26 30 40-48 26 36 36-26"/><path class="g b" d="M-4 96 60 80l26 18 40-36 34 30 40-30 30 22 78-40"/><path class="b" d="M-4 96 60 80l26 18 40-36 34 30 40-30 30 22 78-40"/></svg>',
};
const lookFor = (p, i, list) => LOOK[p.key] || {
  theme: p.billing_interval ? (i === list.length - 1 ? 'thunder' : 'bolt') : 'free',
  line: p.tagline || '', items: [], cta: p.billing_interval ? `Upgrade to ${p.name}` : 'Start free',
};
const byKey = (k) => plans.find((p) => p.key === k);
// the introductory price applies only to customers the server says are eligible (signed out: shown as the offer), and
// only to monthly billing: a yearly plan never shows (or gets) the $1 first month
const introFor = (p) => (p.intro && status?.introEligible !== false && !yearly() ? p.intro : null);
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
  return `<div class="pz-meter cells" role="img" aria-label="${esc(label)}" style="--n:${Math.ceil(maxH)}">${cells}</div>`;
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
  if (!PAID_PLANS || (session && !(yearly() ? status?.yearlyAvailable : status?.upgradesAvailable))) return '<span class="pz-note">Coming soon</span>';
  const intro = introFor(p);
  const cta = intro ? `Get ${p.name} for ${money(intro.price_cents)}` : yearly() ? `Choose ${p.name} yearly` : look.cta;
  if (!session) return `<a class="pz-btn" href="/auth?next=${encodeURIComponent(`/pricing?plan=${p.key}${yearly() ? '&billing=year' : ''}`)}">${esc(cta)}</a>`;
  const label = status && status.plan !== 'free' ? `Switch to ${p.name}${yearly() ? ' yearly' : ''}` : cta;
  return `<button class="pz-btn" type="button" data-plan="${esc(p.key)}"${busy ? ' disabled' : ''}>${busy === p.key ? 'Opening secure checkout…' : esc(label)}</button>`;
}

// ---------- cards ----------
function card(p, i) {
  const look = lookFor(p, i, plans);
  const sp = shownPlan(p);
  const free = plans.find((x) => !x.billing_interval);
  const a = allowance(p.monthly_seconds);
  const pl = yearly() && hasYearly(p) ? yearlyPriceLines(p) : priceLines(sp);
  const sub = look.sub || (yearly() && hasYearly(p) ? `${pl.note} · you save ${money(yearlySavings(p))} a year` : p.billing_interval && !sp.intro ? 'Billed monthly' : pl.note);
  const flash = byKey('flash');
  const items = look.items.map((t) => t.replace('{x:free}', free ? times(p, free) : '').replace('{x:flash}', flash ? times(p, flash) : '').replace('{ph}', perHour(p) || ''))
    .filter((t) => !/^\s*(Flash|Free)’s/.test(t)); // a multiplier whose plan isn't in the lineup is left out
  let callout = '';
  if (p.key === 'bolt' && p.features.includes('focused_review')) {
    callout = `<div class="pz-x"><span class="pz-x-text"><b>${esc(FEATURE.focused_review.name)}</b><span>${esc(FEATURE.focused_review.text)}</span></span></div>`;
  } else if (p.key === 'thunder' && p.features.includes('across_ask')) {
    callout = `<div class="pz-x feature"><div class="pz-connect" aria-hidden="true"><span>Lecture 4</span><span>Lecture 5</span><span>Lecture 6</span><i></i><b>One study guide</b></div>
      <span class="pz-x-text"><b>Three lectures. One study guide.</b><span>${esc(FEATURE.across_ask.text)}</span><span class="pz-x-more">Plus combined study guides from up to 10 recordings.</span></span></div>`;
  } else if (p.key === 'flash' && sp.intro) {
    callout = `<div class="pz-x calm"><span class="pz-x-text"><b>Start for just ${esc(money(sp.intro.price_cents))}</b><span>Your first month, for new subscribers. Then ${esc(money(p.price_cents))}/month.</span></span></div>`;
  } else if (p.key === 'free') {
    callout = '<div class="pz-x calm"><span class="pz-x-text"><b>The real app, not a demo</b><span>Transcribe a recording, then try notes, Ask, flashcards and quizzes on it.</span></span></div>';
  }
  const isCurrent = status && status.plan === p.key;
  return `
  <article class="pz-card t-${look.theme}${isCurrent ? ' is-current' : ''}" aria-labelledby="pz-${esc(p.key)}" style="--d:${i}">
    ${FX[look.theme] ? `<span class="pz-fx">${FX[look.theme]}</span>` : ''}
    <header class="pz-head">
      <span class="pz-ic">${ICON[look.theme] || ICON.bolt}</span>
      <h3 id="pz-${esc(p.key)}">${esc(p.name)}</h3>
      ${look.tag ? `<span class="pz-tag">${esc(look.tag)}</span>` : ''}
    </header>
    ${look.line ? `<p class="pz-line">${esc(look.line)}</p>` : ''}
    ${look.best ? `<p class="pz-who"><b>Best for:</b> ${esc(look.best)}</p>` : ''}
    <div class="pz-price">
      <span class="pz-amt" aria-live="polite">${esc(pl.amount)}</span><span class="pz-per">${esc(pl.per)}</span>
    </div>
    <p class="pz-then${sp.intro ? ' strong' : ''}">${esc(sub || '')}</p>
    <div class="pz-allow">
      <p class="pz-allow-top"><span class="pz-num">${esc(a.num)}</span><span class="pz-unit">${esc(a.unit)}</span><span class="pz-of">of transcription a month</span></p>
      ${meter(p)}
    </div>
    ${callout}
    ${items.length ? `<ul class="pz-list">${items.map((t) => `<li>${CHECK}<span>${esc(t)}</span></li>`).join('')}</ul>` : ''}
    <div class="pz-cta">${ctaFor(p, look)}</div>
    ${pl.renewal ? `<p class="pz-renew">${esc(pl.renewal)} Cancel anytime.</p>` : '<p class="pz-renew">No payment details needed.</p>'}
  </article>`;
}

// the Monthly / Yearly switch (shown only when yearly prices exist); the savings badge is the smallest saving, so it
// is true for every plan
function renderBilling() {
  const box = $('billing');
  box.hidden = !yearlyShown();
  if (box.hidden) return;
  const saves = plans.filter(hasYearly).map(yearlySavings).filter((x) => x > 0).sort((a, b) => a - b);
  $('billingNote').textContent = saves.length
    ? `Pay yearly and save ${money(saves[0])}${saves.length > 1 ? ` to ${money(saves[saves.length - 1])}` : ''} a year, depending on the plan. Your hours still renew every month.`
    : '';
  box.dataset.v = interval;
  box.querySelectorAll('[role="radio"]').forEach((b) => { const on = b.dataset.v === interval; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
}
function setInterval_(v, focus) {
  if (v === interval) return;
  interval = v;
  const u = new URL(location.href);
  if (v === 'year') u.searchParams.set('billing', 'year'); else u.searchParams.delete('billing');
  history.replaceState(null, '', u);
  renderBilling(); renderCards(true); renderCompare(); renderFaq();
  if (focus) $('billing').querySelector(`[data-v="${v}"]`)?.focus();
}
function bindBilling() {
  const seg = $('billingSeg');
  seg.addEventListener('click', (e) => { const b = e.target.closest('[role="radio"]'); if (b) setInterval_(b.dataset.v); });
  seg.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    setInterval_(interval === 'year' ? 'month' : 'year', true);
  });
}

function renderCards(swap = false) {
  $('plans').innerHTML = plans.map(card).join('');
  // switching monthly/yearly: the new prices slide in (CSS); the right amount is in place from the first frame
  if (swap) { $('plans').classList.remove('pz-swap'); void $('plans').offsetWidth; $('plans').classList.add('pz-swap'); }
  $('plans').removeAttribute('aria-busy');
  $('plans').querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', () => upgrade(b.dataset.plan)));
  const maxH = Math.max(...plans.map((x) => x.monthly_seconds)) / 3600;
  $('legend').hidden = maxH > 24;
  const paid = plans.some((p) => p.billing_interval);
  $('disclose').hidden = !paid;
  const flash = byKey('flash'), intro = flash && introFor(flash);
  const billed = yearly()
    ? 'Yearly plans are paid once a year and renew every year until you cancel; your transcription time still renews every month. The $1 Flash first month is for monthly billing only.'
    : 'Paid plans renew every month until you cancel.';
  $('disclose').innerHTML = `Prices in US dollars. ${intro ? `The ${esc(money(intro.price_cents))} Flash price is for your first month only, for new subscribers; Flash then renews at ${esc(money(flash.price_cents))}/month. ` : ''}${billed} Cancel anytime in Plan &amp; billing and keep your plan until the end of the period you’ve paid for. Any applicable tax is shown at checkout before you pay. Under 18? A parent or guardian must buy a paid plan. <a href="/terms">Terms of Service</a>`;
}

// ---------- Which plan fits your semester? (who each plan is for; the numbers live in the comparison) ----------
// the strike across the top of a "Which plan fits" card on hover (pricing.css): a straight run with one sharp zigzag
const FIT_ZAP = '<svg class="fit-zap" viewBox="0 0 300 24" preserveAspectRatio="none" aria-hidden="true"><path pathLength="100" d="M0 2H80l15 18 11-13 13 16 11-21H300"/><path class="hot" pathLength="100" d="M0 2H80l15 18 11-13 13 16 11-21H300"/></svg>';
function renderWhy() {
  const flash = byKey('flash'), bolt = byKey('bolt'), thunder = byKey('thunder');
  const el = $('why');
  if (!flash || !bolt || !thunder) { el.hidden = true; return; }
  const fit = [
    [flash, 'flash', 'Occasional recordings and quick study sessions', ['A tough lecture you want to revisit', 'Notes and a quiz before a test', 'A guest talk or a group meeting']],
    [bolt, 'bolt', 'Weekly lectures, deeper review, regular classes', ['Two or three classes recorded every week', 'Focused Review on the questions you miss', 'Steady revision through the term']],
    [thunder, 'thunder', 'Many courses, connected lectures, advanced study', ['A full course load, lecture after lecture', 'One question asked across a whole unit', 'One study guide from up to 10 recordings']],
  ];
  el.innerHTML = `<header class="sec-head pz-sec-head"><h2 id="whyTitle">Which plan fits your semester?</h2><p>Choose by how you study, not by how much you can spend.</p></header>
    <div class="pz-fit">${fit.map(([p, t, line, ex]) => `<article class="pz-fit-col t-${t}">${FIT_ZAP}<span class="pz-fit-ic">${ICON[t]}</span><h3>${esc(p.name)}</h3><p class="pz-fit-line">${esc(line)}</p>
      <ul>${ex.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p class="pz-fit-hours"><b>${esc(allowance(p.monthly_seconds).long)}</b> a month</p></article>`).join('')}</div>`;
  el.hidden = false;
}

// ---------- comparison: the meaningful differences ----------
function renderCompare() {
  const yes = `<span class="pz-yes">${CHECK}<span class="sr-only">Included</span></span>`;
  const dash = '<span class="pz-na"><span aria-hidden="true">—</span><span class="sr-only">Not included</span></span>';
  const has = (cap) => (p) => (p.features.includes(cap) ? yes : dash);
  const rows = [
    yearly()
      ? ['Yearly price', (p) => (hasYearly(p) ? `<b>${esc(money(p.yearly_price_cents))}</b><small>save ${esc(money(yearlySavings(p)))} vs monthly</small>` : `<b>${esc(money(0))}</b>`)]
      : ['Monthly price', (p) => { const i = introFor(p); return i ? `<b>${esc(money(p.price_cents))}</b><small>${esc(money(i.price_cents))} first month</small>` : `<b>${esc(money(p.price_cents))}</b>`; }],
    ['Transcription each month', (p) => `<b>${esc(allowance(p.monthly_seconds).long)}</b>`],
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
    yearlyShown() && ['How does yearly billing work?', `You pay once for the year (${plans.filter(hasYearly).map((p) => `${p.name} ${money(p.yearly_price_cents)}`).join(', ')}), which costs less than 12 months at the regular monthly price. Your transcription time still renews every month, so you get the plan’s full monthly time all year. The $1 Flash first month is only for monthly billing. You can cancel anytime: the plan stays until the end of the year you paid for and doesn’t renew.`],
    ['Can I upgrade later?', 'Yes, whenever you like. An upgrade takes effect right away: you get the higher plan’s monthly time and features, and you pay only the prorated difference for the rest of your current billing period.'],
    ['Can I cancel anytime?', 'Yes, in Plan & billing → Manage billing. Your plan stays active until the end of the period you’ve paid for, then you move to the Free plan. No further payments are taken, and nothing in your library is deleted.'],
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
    await startCheckout(plan, yearly() ? 'year' : 'month'); // navigates to Stripe
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
  if (PAID_PLANS && (!session || status?.upgradesAvailable)) $('billFoot').textContent = `${yearlyShown() ? 'Monthly or yearly plans' : 'Monthly plans'} · secure payments by Stripe`;
  // the HTML's footer assumes payments are on (what crawlers should read on the live site); say so when they aren't
  if (!PAID_PLANS || (session && !status?.upgradesAvailable)) $('billFoot').textContent = 'Paid plans coming soon · the Free plan is available today';
  if (!PAID_PLANS || (session && !status?.upgradesAvailable)) notice('<b>Paid plans are coming soon.</b> The Free plan is available today. Nothing on this page can charge you.');
  renderBilling();
  bindBilling();
  renderCards();
  renderWhy();
  renderCompare();
  renderFaq();
  // back from signing in after choosing a plan (or from a feature that needs one): continue to checkout
  const wanted = q.get('plan');
  if (PAID_PLANS && (yearly() ? status?.yearlyAvailable : status?.upgradesAvailable) && session && wanted && plans.some((p) => p.key === wanted && p.billing_interval) && status?.plan === 'free') upgrade(wanted);
  else if (wanted && byKey(wanted)) document.getElementById(`pz-${wanted}`)?.closest('.pz-card')?.classList.add('is-selected');
  // from a feature that belongs to a plan (e.g. Thunder's Ask across recordings): point at that plan, never start
  // checkout by itself; the student chooses it on the card
  const hl = q.get('highlight');
  const card = hl && byKey(hl) && !wanted ? document.getElementById(`pz-${hl}`)?.closest('.pz-card') : null;
  if (card) {
    card.classList.add('is-selected');
    card.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}
main();
