// AI usage limits as a user meets them (server ledger in the harness memory store, mock AI): what Summary, Ask and
// Create show when the hourly or monthly limit refuses a request, that nothing is generated, and that removing the
// limit restores normal use. Run on /transcript?id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb after a fresh harness start.
import { $, $$, sleep, waitFor, runTests, assert, eq } from './lib.js';

const limits = async (q = '') => (await fetch('/__harness/ai-limits' + q)).json();
const tab = (name) => { const b = [...$$('#resTabs [role="tab"], #resTabs button')].find((x) => new RegExp(name, 'i').test(x.textContent)); assert(b, `tab ${name}`); b.click(); };
const pageText = () => document.body.innerText.replace(/\s+/g, ' ');
const HOURLY = /a lot in the last hour\. Try again in about \d+ minutes/;
const MONTHLY = /this month's AI allowance on your plan\. It renews on November 1/;

export async function run() {
  await limits('?clear=1');
  return runTests([
    ['hourly limit: Summary shows the limit message with a retry time, and nothing is generated', async () => {
      await limits('?perHour=0');
      tab('Summary');
      const btn = await waitFor(() => [...$$('#insightsHost button')].find((b) => /Summarize/.test(b.textContent)), { what: 'summarize button' });
      btn.click();
      await waitFor(() => HOURLY.test(pageText()), { what: 'hourly message' });
      assert(!$('.sum-tldr'), 'no summary rendered');
      assert($('#insightsHost .ins-msg.warn') && !/couldn.t be generated/.test(pageText()), 'shown as a limit notice, not as a failure');
      eq((await limits('?perHour=0')).ledger.length, 0, 'ledger rows after a refusal');
    }],
    ['hourly limit: Ask (streamed) shows the same message in the thread and the question can be retried', async () => {
      tab('Ask');
      const input = await waitFor(() => $('.ask-input'), { what: 'ask input' });
      input.value = 'When is the launch?'; input.dispatchEvent(new Event('input', { bubbles: true }));
      $('.ask-form').requestSubmit();
      await waitFor(() => HOURLY.test(pageText()), { what: 'hourly message in Ask' });
      assert(!$('.ask-input').disabled, 'the input is usable again');
      assert(!/answer couldn.t be generated/.test(pageText()), 'no failure wording for a limit');
    }],
    ['monthly allowance: Create shows the renewal date', async () => {
      await limits('?perHour=100&budget=1');
      tab('Create');
      const tool = await waitFor(() => $('[data-tool="flashcards"]') || $('[data-tool]:not([data-tool="export"])'), { what: 'a Create tool' });
      tool.click();
      const create = await waitFor(() => $('[data-act="create"]'), { what: 'Create button' });
      create.click();
      await waitFor(() => MONTHLY.test(pageText()), { timeout: 10000, what: 'monthly message' });
      const box = $$('.ins-msg.warn').find((m) => MONTHLY.test(m.textContent));
      assert(box && !box.querySelector('button'), 'no retry button for the monthly allowance');
      eq((await limits('?perHour=100&budget=1')).ledger.length, 0, 'ledger rows after a refusal');
    }],
    ['no limit: the same actions work again and each model call is one settled ledger row', async () => {
      await limits();
      tab('Summary');
      const btn = await waitFor(() => [...$$('#insightsHost button')].find((b) => /Summarize|Try again/.test(b.textContent)), { what: 'summarize / try again' });
      btn.click();
      await waitFor(() => $('.sum-tldr'), { timeout: 15000, what: 'summary rendered' });
      await sleep(300);
      const { ledger } = await limits();
      assert(ledger.length >= 1 && ledger.every((r) => r.status === 'done' && r.cost != null), `ledger: ${JSON.stringify(ledger.map((r) => [r.feature, r.status, r.cost]))}`);
    }],
  ]);
}
