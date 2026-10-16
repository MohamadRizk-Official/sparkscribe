// Billing UI with payments unavailable (the pre-launch state), against the harness's offline billing mock.
// Run each export on its page:  /pricing → pricing(),  /account → account(),  / → home()
import { $, $$, sleep, waitFor, visible, makeWav, feed, knobs, runTests, assert, eq } from './lib.js';

const text = (el) => (el?.innerText || '').replace(/\s+/g, ' ').trim();
const checkoutCalls = () => (window.__qaBilling || []).filter((a) => a === 'checkout' || a === 'portal').length;

export async function pricing() {
  return runTests([
    ['pricing (signed in, Free): four plans from the plan table; paid plans say "Coming soon"; nothing can start a payment', async () => {
      await waitFor(() => $$('.pz-card').length === 4, { what: 'plan cards' });
      const cards = $$('.pz-card');
      eq(cards.map((c) => text(c.querySelector('h3'))).join(), 'Free,Flash,Bolt,Thunder', 'lineup');
      assert(/Your current plan/.test(text(cards[0])), 'Free is the current plan');
      assert(cards.slice(1).every((c) => /Coming soon/.test(text(c))), 'Flash, Bolt, Thunder: Coming soon');
      eq($$('button[data-plan], .pz-card a[href*="plan="]').length, 0, 'upgrade buttons/links');
      assert(/Paid plans are coming soon/.test(text($('.bill-notice') || document.body)), 'notice explains it');
      assert(/30\s*min/.test(text(cards[0])) && /\$1\b/.test(text(cards[1])) && /Then \$5\.99\/month/.test(text(cards[1])) && /\$9\.99/.test(text(cards[2])) && /\$14\.99/.test(text(cards[3])), 'prices and allowances from the plan table, Flash with its renewal price');
      assert(/9\s*hours/.test(text(cards[2])) && /20\s*hours/.test(text(cards[3])) && /3\s*hours/.test(text(cards[1])), 'allowances: 3, 9, 20 hours');
      eq(checkoutCalls(), 0, 'checkout/portal requests');
      assert(/coming soon/i.test(text($('#billFoot'))) && !/Stripe/.test(text($('#billFoot'))), `footer doesn't advertise payments (${text($('#billFoot'))})`);
      assert(/save to your library/.test($('.faq-list').textContent), 'FAQ: only saved recordings count');
    }],
    ['the comparison names what Bolt and Thunder add, from the plans themselves; nothing is labelled "in development"', async () => {
      const table = await waitFor(() => $('#compareTable table'), { what: 'comparison' });
      const row = (name) => [...table.querySelectorAll('tbody tr')].find((r) => r.querySelector('th').textContent.startsWith(name));
      const cells = (r) => [...r.querySelectorAll('td')].map((td) => (td.querySelector('.pz-yes') ? 'Y' : '-')).join('');
      eq(cells(row('Focused Review')), '--YY', 'Focused Review: Bolt and Thunder');
      eq(cells(row('Ask across recordings')), '---Y', 'Ask across recordings: Thunder');
      eq(cells(row('Combined study guides')), '---Y', 'Combined study guides: Thunder');
      assert(!/in development|not included in thunder yet/i.test(document.body.innerText), 'no "in development" label');
      assert(/What is Focused Review\?/.test($('.faq-list').textContent) && /asking across recordings/.test($('.faq-list').textContent), 'FAQ explains both');
    }],
    ['pricing ?plan=flash after sign-in does not auto-start checkout', async () => {
      history.replaceState(null, '', '/pricing?plan=flash');
      const mod = await import('/src/pages/pricing.js?again=' + Date.now()).catch(() => null);
      await sleep(600);
      eq(checkoutCalls(), 0, 'checkout requests');
      history.replaceState(null, '', '/pricing');
      void mod;
    }],
  ]);
}

// /account, run once per plan knob: account('free') then (after __qaKnobs({ plan: 'thunder' }) + reload) account('thunder')
export async function account(plan = 'free') {
  return runTests([
    [`account page (${plan}): plan, allowance, what it includes, upgrade paths; no billing buttons while payments are off`, async () => {
      await waitFor(() => $('.acct-plan h2'), { what: 'plan card' });
      const want = { free: ['Free', '30 minutes'], flash: ['Flash', '3 hours'], bolt: ['Bolt', '9 hours'], thunder: ['Thunder', '20 hours'] }[plan];
      eq(text($('.acct-plan h2')), want[0], 'plan');
      assert(text($('.acct-allow')).includes(want[1]), `allowance: ${text($('.acct-allow'))}`);
      assert($('.meter') && /(min|hr)/.test(text($('.meter'))), 'usage meter');
      const feats = $$('.acct-feats li').map(text).join();
      eq(feats, { free: '', flash: '', bolt: 'Focused Review', thunder: 'Focused Review,Ask across recordings,Combined study guides' }[plan], 'included capabilities');
      const paths = $$('.acct-paths li b').map(text).join();
      eq(paths, { free: 'Flash,Bolt,Thunder', flash: 'Bolt,Thunder', bolt: 'Thunder', thunder: '' }[plan], 'upgrade paths (every higher plan)');
      if (plan === 'free') assert(/\$1 first month, then \$5\.99\/month/.test(text($('.acct-paths'))), 'Flash shows its first-month price with the renewal price');
      eq($$('[data-up]').length, 0, 'upgrade buttons while payments are off');
      // a subscriber can always reach Manage Billing (to cancel or fix a card); Free has nothing to manage
      eq($$('[data-act="portal"]').length, plan === 'free' ? 0 : 1, 'Manage Billing');
      assert($('a[href="/pricing"]'), 'Compare plans link');
      if (plan === 'free') assert(!/Stripe/.test(text($('#acctFoot'))), `footer doesn't mention payments (${text($('#acctFoot'))})`);
    }],
  ]);
}

export async function home() {
  const reset = () => knobs({ enforced: false, usedSeconds: 0, upgrades: false, quotaSave: false, worker: 'fake', runMs: 200, lines: 'meeting', saveDelayMs: 0, failSave: false });
  const toDrop = async () => {
    if (visible($('#newBtn'))) $('#newBtn').click();
    await sleep(50);
    document.querySelector('dialog[open]')?.querySelector('[data-act="ok"]')?.click();
    if (visible($('#gatePanel'))) $('#gatePanel [data-gate="back"]').click();
    await waitFor(() => visible($('#dropPanel')), { what: 'drop panel' });
  };
  return runTests([
    ['usage line under the upload area for signed-in users', async () => {
      reset();
      await waitFor(() => visible($('#usageLine')), { what: 'usage line' });
      assert(/Free · 0 \/ 30 min used this month/.test(text($('#usageLine'))), `line: ${text($('#usageLine'))}`);
    }],
    ['quota enforced and the recording is too long: clear message, no upgrade button (payments off), nothing transcribed', async () => {
      reset(); knobs({ enforced: true, usedSeconds: 1790 });
      feed(makeWav(30));
      await waitFor(() => visible($('#gatePanel')), { what: 'quota message' });
      assert(/Not enough transcription time left/.test(text($('#gatePanel'))), text($('#gatePanel')));
      eq($$('#gatePanel [data-upgrade]').length, 0, 'upgrade buttons');
      assert(!visible($('#resultsPanel')), 'no transcript');
      await toDrop();
    }],
    ['…with payments switched on, the same message offers the upgrade (UI mirrors the server)', async () => {
      reset(); knobs({ enforced: true, usedSeconds: 1790, upgrades: true });
      feed(makeWav(30));
      await waitFor(() => visible($('#gatePanel')), { what: 'quota message' });
      assert($('#gatePanel [data-upgrade="flash"]'), 'upgrade to Flash (the next plan) offered');
      await toDrop();
      reset();
    }],
    ['a save refused by the database quota keeps the transcript on screen and explains it', async () => {
      reset(); knobs({ quotaSave: true });
      feed(makeWav(10));
      await waitFor(() => /longer than the transcription time left/.test(text($('#saveBar'))), { what: 'quota save message' });
      assert(visible($('#resultsPanel')), 'transcript still shown');
      reset();
      await toDrop();
    }],
  ]);
}

// on / after signing out locally (sessionStorage.__signedOut = '1' and a reload)
export async function homeSignedOut() {
  return runTests([
    ['signed out: a recording is transcribed without a sign-in gate', async () => {
      knobs({ worker: 'fake', runMs: 200, lines: 'meeting' });
      feed(makeWav(10));
      await waitFor(() => visible($('#resultsPanel')), { what: 'results' });
      assert(!visible($('#gatePanel')), 'no gate');
      assert(/Create free account|Sign in/.test(text($('#saveBar'))), 'offers an account to save');
    }],
  ]);
}
