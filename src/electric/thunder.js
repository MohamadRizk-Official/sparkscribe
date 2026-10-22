// ELECTRIC — Thunder's identity and its upgrade path, shared by Ask, the Library and /across.
// Asking across recordings and combined study guides are Thunder features (billing_plans.features; the server refuses
// them for other plans: server/entitlements.js). On another plan, choosing one explains what it does with an example and
// leads to Pricing with Thunder highlighted, keeping where the student wanted to go (sessionStorage afterUpgrade).
import { makeDialog } from '../library/dialogs.js';

const BOLT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.2 2.5 5.5 13.4h5.2l-1.4 8.1 7.7-11h-5.2z"/></svg>';
// the mark: a violet bolt and the plan name; on hover/focus of the control that holds it, a short current runs through
export const thunderMark = (label = 'Thunder') => `<span class="thunder-mark">${BOLT}<span>${label}</span><i class="tm-arc" aria-hidden="true"></i></span>`;

const COPY = {
  ask: {
    title: 'Connect the dots across your lectures',
    text: 'Ask one question across up to 12 of your recordings. Each point names the recording it comes from and links to the exact moment; if they don’t answer it, SparkScribe says so.',
    q: 'Which ideas came up in all three biology lectures?',
    a: ['Cell respiration', 'Lecture 4 · 12:30', 'Lecture 6 · 21:45'],
  },
  guide: {
    title: 'Three lectures. One study guide.',
    text: 'Build one study guide from up to 10 recordings: the themes they share, where each was taught, how they differ, and questions to check yourself.',
    q: 'Unit 2 review guide',
    a: ['Shared themes', 'Lecture 4 + 5', 'Lecture 6'],
  },
};

export const thunderPricingUrl = (back) => `/pricing?highlight=thunder${back ? `&next=${encodeURIComponent(back)}` : ''}`;

export function openThunderDialog({ feature = 'ask', back = location.pathname + location.search, planName = '' } = {}) {
  const c = COPY[feature] || COPY.ask;
  const { dlg, dismiss } = makeDialog('thunder-dlg', `
    <div class="th-head">${thunderMark()}<h3>${c.title}</h3><p>${c.text}</p></div>
    <div class="th-example" aria-label="Example"><span class="cr-sample-tag">Example</span>
      <p class="th-q">${c.q}</p>
      <div class="th-links"><span>${c.a[0]}</span><i aria-hidden="true"></i><span>${c.a[1]}</span><span>${c.a[2]}</span></div></div>
    <p class="th-plan">Available with Thunder${planName ? `. You’re on ${planName}.` : '.'} Everything you’ve saved stays on every plan.</p>
    <div class="confirm-actions"><button class="btn btn-ghost" type="button" data-act="cancel">Not now</button>
      <a class="btn th-cta" href="${thunderPricingUrl(back)}">${BOLT}<span>Explore Thunder</span></a></div>`);
  dlg.querySelector('[data-act=cancel]').addEventListener('click', dismiss);
  dlg.querySelector('.th-cta').focus();
  return dlg;
}
