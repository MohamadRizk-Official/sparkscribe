// Yearly billing on /pricing and /account (harness with VITE_PAID_PLANS=1: launch config "paid-harness").
// /pricing: set knobs { upgrades: true, checkoutOk: true }, reload, run pricing(); reload /pricing, run pricingMonthly().
// /account: set knobs { plan: 'bolt', yearly: true, upgrades: true, checkoutOk: true }, reload, run account(); then
//           knobs { yearly: false } (monthly Bolt), reload, run accountMonthly().
import { $, $$, sleep, waitFor, runTests, assert, eq } from './lib.js';

const text = (el) => (el?.innerText || '').replace(/\s+/g, ' ').trim();
const cardOf = (name) => $$('.pz-card').find((c) => c.querySelector('h3')?.textContent.trim() === name);
const seg = () => $('#billingSeg');
const checkouts = () => (window.__qaBilling || []).filter((a) => String(a).startsWith('checkout:'));

export async function pricing() {
  return runTests([
    ['Monthly by default: Flash shows the $1 first month; the switch offers Yearly with its saving', async () => {
      await waitFor(() => $$('.pz-card').length === 4, { what: 'cards' });
      assert(!$('#billing').hidden, 'billing switch shown');
      eq(seg().querySelector('[aria-checked="true"]').dataset.v, 'month', 'monthly selected');
      // the saving in plain words with exact amounts (no single percentage that isn't true for every plan)
      assert(/Pay yearly and save \$12\.88 to \$30\.88 a year/.test(text($('#billingNote'))), text($('#billingNote')));
      assert(!/%/.test(text($('#billing'))), 'no percentage badge');
      assert(/\$1 first month/.test(text(cardOf('Flash'))) && /Then \$5\.99\/month/.test(text(cardOf('Flash'))), text(cardOf('Flash')));
    }],
    ['Yearly: $59 / $99 / $149 a year, per-month equivalent and saving, no $1 offer anywhere on Flash', async () => {
      seg().querySelector('[data-v="year"]').click();
      await waitFor(() => /\/year/.test(text(cardOf('Flash'))), { what: 'yearly prices' });
      assert(new URL(location.href).searchParams.get('billing') === 'year', 'URL remembers yearly');
      const f = text(cardOf('Flash')), b = text(cardOf('Bolt')), t = text(cardOf('Thunder'));
      assert(/\$59 \/year/.test(f) && /\$4\.92\/month, billed yearly · you save \$12\.88 a year/.test(f), f);
      assert(!/\$1\b/.test(f) && !/first month/i.test(f) && !cardOf('Flash').querySelector('.pz-ribbon'), `Flash yearly shows no $1 offer: ${f}`);
      assert(/\$99 \/year/.test(b) && /\$8\.25\/month/.test(b) && /you save \$20\.88 a year/.test(b), b);
      assert(/\$149 \/year/.test(t) && /\$12\.42\/month/.test(t) && /you save \$30\.88 a year/.test(t), t);
      assert(/3 hours renew every month/.test(f), 'the monthly allowance is stated');
      assert(/Choose Flash yearly/.test(f), 'CTA says yearly');
      assert(/Free/.test(text(cardOf('Free'))) && /\$0/.test(text(cardOf('Free'))), 'Free unchanged');
    }],
    ['Yearly disclosures, comparison and FAQ', async () => {
      assert(/Yearly plans are paid once a year/.test(text($('#disclose'))) && /\$1 Flash first month is for monthly billing only/.test(text($('#disclose'))), text($('#disclose')));
      assert(/Yearly price/.test(text($('#compareTable'))) && /save \$20\.88 vs monthly/.test(text($('#compareTable'))), 'comparison shows yearly prices');
      assert($$('.faq-item summary').some((s) => /How does yearly billing work/.test(s.textContent)), 'FAQ explains yearly');
    }],
    ['Choosing a yearly plan sends plan + interval to the server (which picks the price)', async () => {
      const before = checkouts().length;
      cardOf('Bolt').querySelector('[data-plan]').click();
      await waitFor(() => checkouts().length > before, { what: 'checkout call' });
      eq(checkouts().at(-1), 'checkout:bolt:year', 'checkout request');
      await waitFor(() => location.hash === '#qa_checkout=bolt:year', { what: 'redirect to the URL the server returned' });
    }],
    ['Arrow keys switch back to Monthly; the $1 Flash offer returns, checkout is monthly', async () => {
      history.replaceState(null, '', location.pathname + location.search);
      seg().querySelector('[aria-checked="true"]').focus();
      seg().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      await waitFor(() => /first month/.test(text(cardOf('Flash'))), { what: 'monthly again' });
      eq(document.activeElement?.dataset.v, 'month', 'focus follows');
      assert(!new URL(location.href).searchParams.has('billing'), 'URL back to monthly');
    }],
  ]);
}

// a fresh /pricing load (a checkout leaves the page busy, as it normally navigates to Stripe)
export async function pricingMonthly() {
  return runTests([
    ['Monthly Flash checkout: plan + month', async () => {
      await waitFor(() => cardOf('Flash')?.querySelector('[data-plan]'), { what: 'Flash button' });
      cardOf('Flash').querySelector('[data-plan]').click();
      await waitFor(() => checkouts().length, { what: 'checkout call' });
      eq(checkouts().at(-1), 'checkout:flash:month', 'monthly checkout');
    }],
  ]);
}

export async function account() {
  return runTests([
    ['Yearly Bolt: price per year, yearly renewal and monthly time renewal both stated', async () => {
      await waitFor(() => $('.acct-plan'), { what: 'plan card' });
      const t = text($('#account'));
      assert(/Bolt \$99\/year/.test(t), t.slice(0, 200));
      assert(/Billed yearly · renews .+\. Your transcription time renews .+\./.test(t), t.slice(0, 300));
      assert(/9 hours of transcription a month/.test(t) && /Transcription this month/i.test(t), 'allowance is monthly');
    }],
    ['A yearly subscriber upgrades within yearly billing', async () => {
      const b = $$('[data-up]').find((x) => /Thunder/.test(x.textContent));
      assert(b && /\$149\/year/.test(b.textContent) && b.dataset.interval === 'year', b?.textContent);
      assert(!$$('[data-up]').some((x) => /Switch to yearly/.test(x.textContent)), 'no "switch to yearly" when already yearly');
      b.click();
      await waitFor(() => (window.__qaBilling || []).includes('checkout:thunder:year'), { what: 'yearly upgrade request' });
    }],
  ]);
}

export async function accountMonthly() {
  return runTests([
    ['Monthly Bolt: offered "Switch to yearly" with the saving', async () => {
      await waitFor(() => $('.acct-plan'), { what: 'plan card' });
      assert(/Bolt \$9\.99\/month/.test(text($('#account'))), text($('#account')).slice(0, 120));
      const y = $$('[data-up]').find((x) => /Switch to yearly/.test(x.textContent));
      assert(y && /\$99\/year, save \$20\.88/.test(y.textContent) && y.dataset.interval === 'year', y?.textContent);
      y.click();
      await waitFor(() => (window.__qaBilling || []).includes('checkout:bolt:year'), { what: 'switch request' });
    }],
  ]);
}
