// Billing UI with payments unavailable (the pre-launch state), against the harness's offline billing mock.
// Run each export on its page:  /pricing → pricing(),  /account → account(),  / → home()
import { $, $$, sleep, waitFor, visible, makeWav, feed, knobs, runTests, assert, eq } from './lib.js';

const text = (el) => (el?.innerText || '').replace(/\s+/g, ' ').trim();
const checkoutCalls = () => (window.__qaBilling || []).filter((a) => a === 'checkout' || a === 'portal').length;

export async function pricing() {
  return runTests([
    ['pricing (signed in, Free): paid plans say "Coming soon", nothing can start a payment', async () => {
      await waitFor(() => $$('.plan-card').length === 3, { what: 'plan cards' });
      const cards = $$('.plan-card');
      assert(/Your current plan/.test(text(cards[0])), 'Free is the current plan');
      assert(/Coming soon/.test(text(cards[1])) && /Coming soon/.test(text(cards[2])), 'Plus and Pro: Coming soon');
      eq($$('[data-plan], .plan-card a[href*="plan="]').length, 0, 'upgrade buttons/links');
      assert(/Paid plans are coming soon/.test(text($('.bill-notice') || document.body)), 'notice explains it');
      assert(/\$7\.99/.test(text(cards[1])) && /\$14\.99/.test(text(cards[2])), 'prices still shown from the plan table');
      eq(checkoutCalls(), 0, 'checkout/portal requests');
    }],
    ['pricing ?plan=plus after sign-in does not auto-start checkout', async () => {
      history.replaceState(null, '', '/pricing?plan=plus');
      const mod = await import('/src/pages/pricing.js?again=' + Date.now()).catch(() => null);
      await sleep(600);
      eq(checkoutCalls(), 0, 'checkout requests');
      history.replaceState(null, '', '/pricing');
      void mod;
    }],
  ]);
}

export async function account() {
  return runTests([
    ['account page: plan, usage meter, no upgrade or billing buttons while payments are off', async () => {
      await waitFor(() => $('.acct-plan h2'), { what: 'plan card' });
      eq(text($('.acct-plan h2')), 'Free', 'plan');
      assert($('.meter') && /min/.test(text($('.meter'))), 'usage meter');
      eq($$('[data-up], [data-act="portal"]').length, 0, 'upgrade / manage billing buttons');
      assert($('a[href="/pricing"]'), 'Compare plans link');
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
      assert(/Free · 0 \/ 60 min used this month/.test(text($('#usageLine'))), `line: ${text($('#usageLine'))}`);
    }],
    ['quota enforced and the recording is too long: clear message, no upgrade button (payments off), nothing transcribed', async () => {
      reset(); knobs({ enforced: true, usedSeconds: 3590 });
      feed(makeWav(30));
      await waitFor(() => visible($('#gatePanel')), { what: 'quota message' });
      assert(/Not enough transcription time left/.test(text($('#gatePanel'))), text($('#gatePanel')));
      eq($$('#gatePanel [data-upgrade]').length, 0, 'upgrade buttons');
      assert(!visible($('#resultsPanel')), 'no transcript');
      await toDrop();
    }],
    ['…with payments switched on, the same message offers the upgrade (UI mirrors the server)', async () => {
      reset(); knobs({ enforced: true, usedSeconds: 3590, upgrades: true });
      feed(makeWav(30));
      await waitFor(() => visible($('#gatePanel')), { what: 'quota message' });
      assert($('#gatePanel [data-upgrade="plus"]'), 'upgrade to Plus offered');
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
