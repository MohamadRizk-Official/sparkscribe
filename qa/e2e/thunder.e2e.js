// Thunder's features from another plan (2026-10-22: Flash users were sent to /across and shown "Choose recordings"
// with no word about Thunder). Each stage runs on the page named, with the plan set BEFORE the page loads:
//   __qaKnobs({ plan: 'flash' }) + /transcript?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:  (await import('/qa/e2e/thunder.e2e.js')).ask()
//   (still Flash) /across:                                                              .emptyAcross()
//   /pricing?highlight=thunder&next=%2Facross:                                         .pricing()
//   __qaKnobs({ plan: 'thunder' }) + the same /transcript page:                         .thunderAsk()
import { $, sleep, waitFor, runTests, assert, eq } from './lib.js';

const REC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const openAsk = async () => {
  const tab = await waitFor(() => $('[data-tab="ask"]'), { what: 'Ask tab' });
  tab.click();
  return waitFor(() => $('.ask-across'), { what: 'the across link' });
};

export function ask() {
  return runTests([
    ['Ask on one recording stays available on Flash', async () => {
      await openAsk();
      assert($('.ask-form') && !$('.ask-input').disabled, 'the question box');
      assert(document.querySelectorAll('.starter').length >= 3, 'suggested questions');
    }],
    ['Flash: "Ask across several recordings" carries the Thunder mark and opens an explanation, not /across', async () => {
      const link = await openAsk();
      assert(link.querySelector('.thunder-mark svg'), 'violet bolt mark');
      await sleep(400); // the plan has loaded
      link.click();
      const dlg = await waitFor(() => $('dialog.thunder-dlg[open]'), { what: 'Thunder explanation' });
      eq(location.pathname, '/transcript', 'stayed on the recording');
      assert(/Connect the dots across your lectures/.test(dlg.innerText), 'title');
      assert(/Which ideas came up/.test(dlg.querySelector('.th-example').innerText), 'one example');
      assert(/You’re on Flash/.test(dlg.innerText), 'names the current plan');
      eq(dlg.querySelector('.th-cta').getAttribute('href'), `/pricing?highlight=thunder&next=${encodeURIComponent(`/across?ids=${REC}`)}`, 'Explore Thunder → Pricing, back to this recording');
      dlg.querySelector('[data-act="cancel"]').click();
      await waitFor(() => !$('dialog.thunder-dlg[open]'), { what: 'closed' });
    }],
  ]);
}

export function emptyAcross() {
  return runTests([
    ['Flash, nothing selected: /across explains Thunder instead of "Choose recordings"', async () => {
      const locked = await waitFor(() => $('#askPanel .ax-locked'), { what: 'Thunder panel', timeout: 10000 });
      assert(!/Choose recordings/.test($('#askPanel').innerText), 'no dead-end empty state');
      assert(locked.querySelector('.thunder-mark') && locked.querySelector('.th-example'), 'mark and example');
      assert(locked.querySelector('a.th-cta[href^="/pricing?highlight=thunder"]'), 'Explore Thunder');
    }],
  ]);
}

export function pricing() {
  return runTests([
    ['Pricing ?highlight=thunder marks the Thunder card, starts no checkout and keeps the way back', async () => {
      const card = await waitFor(() => $('.pz-card.is-selected'), { what: 'highlighted card' });
      assert(card.contains(document.getElementById('pz-thunder')), 'the Thunder card');
      eq(document.querySelectorAll('.pz-card.is-selected').length, 1, 'only one');
      eq(location.pathname, '/pricing', 'no redirect to checkout');
      eq(sessionStorage.getItem('sparkscribe.afterUpgrade'), '/across', 'return path kept');
    }],
  ]);
}

export function thunderAsk() {
  return runTests([
    ['Thunder: the across link goes straight to /across with this recording', async () => {
      const link = await openAsk();
      await sleep(400);
      let prevented = null;
      addEventListener('click', (e) => { if (e.target.closest?.('.ask-across')) { prevented = e.defaultPrevented; e.preventDefault(); } }, { once: true });
      link.click();
      await sleep(100);
      eq(prevented, false, 'navigation not intercepted');
      assert(!$('dialog.thunder-dlg'), 'no explanation dialog');
      eq(link.getAttribute('href'), `/across?ids=${REC}`, 'destination');
    }],
  ]);
}

// On the paid build (launch config "paid-harness"): a Free user signed in with upgrades available, on
// /pricing?highlight=thunder — nothing opens checkout by itself (the harness records a checkout as #qa_checkout=…)
//   __qaKnobs({ plan: 'free', upgrades: true, checkoutOk: true }) + /pricing?highlight=thunder:  .paidHighlight()
export function paidHighlight() {
  return runTests([
    ['Paid build: ?highlight=thunder highlights Thunder and never starts checkout', async () => {
      await waitFor(() => $('.pz-card.is-selected'), { what: 'highlighted card' });
      await sleep(800);
      assert(!/qa_checkout/.test(location.hash), `no checkout started (${location.hash})`);
      assert($('.pz-card.is-selected').contains(document.getElementById('pz-thunder')), 'Thunder card');
      assert($('.pz-card.is-selected [data-plan="thunder"]'), 'the student chooses Thunder on the card');
    }],
  ]);
}

// Plan & billing while a cancellation is pending (status from the billing mock; nothing is changed):
//   __qaKnobs({ plan: 'bolt', cancelAtPeriodEnd: true, upgrades: true }) + /account:  .cancelNotice()
export function cancelNotice() {
  return runTests([
    ['A pending cancellation shows a neutral notice from the real status: plan, end date, what is kept, then Free', async () => {
      const n = await waitFor(() => $('.bill-alert.is-ending'), { what: 'notice' });
      eq(n.getAttribute('role'), 'status', 'announced politely');
      assert(/^Bolt ends \w+ \d+/.test(n.querySelector('.ba-title').textContent), n.querySelector('.ba-title').textContent);
      assert(/9 hours of transcription a month and Focused Review/.test(n.innerText), 'allowance and features kept until then');
      assert(/on Free \(30 minutes a month\)/.test(n.innerText), 'then Free, from billing_plans');
      assert(!/amber|green/.test(getComputedStyle(n).backgroundColor), 'neutral');
    }],
    ['No direct "Switch to …" while it is pending; Manage Billing stays', async () => {
      const labels = [...document.querySelectorAll('.acct-actions .btn')].map((b) => b.textContent.trim());
      assert(!labels.some((l) => /^(Switch|Upgrade) to/.test(l)), labels.join(', '));
      assert(labels.includes('Manage Billing'), labels.join(', '));
    }],
  ]);
}
