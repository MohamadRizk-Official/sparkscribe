// Saved page insights (mock AI): Summary generate / stale / failed update, recording type save failure, Action Plan
// statuses rendering, export after corrections. Run on /transcript?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
import { $, $$, sleep, waitFor, visible, knobs, dbRows, runTests, assert, eq } from './lib.js';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const row = () => dbRows().find((r) => r.id === ID);
const tab = (name) => { const b = [...$$('#resTabs [role="tab"], #resTabs button')].find((x) => new RegExp(name, 'i').test(x.textContent)); assert(b, `tab ${name}`); b.click(); };
const panelText = () => ($('#insightsHost')?.innerText || '').replace(/\s+/g, ' ');
const toastText = () => $('.toast')?.textContent || '';
const mockFail = (on) => fetch('/__harness/fail' + (on ? '?on=1' : ''));

export async function run() {
  return runTests([
    ['Summary: generate once (mock AI), shows TL;DR and key points with line chips', async () => {
      tab('Summary');
      const btn = await waitFor(() => [...$$('#insightsHost button')].find((b) => /Summarize/.test(b.textContent)) || ($('.sum-tldr') && 'done'), { what: 'summarize button or summary' });
      if (btn !== 'done') btn.click();
      await waitFor(() => $('.sum-tldr'), { timeout: 15000, what: 'summary rendered' });
      assert($$('.kp-card').length >= 1, 'key points shown');
      assert(!/Ungrounded point/.test(panelText()), 'the mock\'s ungrounded key point was dropped by grounding');
    }],
    ['D13: a failed "Update" of an out-of-date summary is visible, and the old summary stays', async () => {
      // make the summary out of date: a real change (a paragraph given to another speaker; a plain rename no
      // longer makes results out of date)
      $$('#transcript .grp')[0].querySelector('button.who').click();
      const b = await waitFor(() => [...($('.menu')?.querySelectorAll('button[role="menuitem"]') || [])].find((x) => /^Speaker \d$/.test(x.textContent.trim())), { what: 'reassign item' });
      b.click();
      await waitFor(() => /saved/.test(toastText()), { what: 'saved' });
      tab('Summary');
      const upd = await waitFor(() => [...$$('#insightsHost button')].find((x) => /Update/.test(x.textContent)), { what: 'stale Update button' });
      await mockFail(true);
      upd.click();
      await sleep(2500);
      await mockFail(false);
      const t = panelText();
      assert($('.sum-tldr'), 'the previous summary is still shown');
      assert(/couldn|failed|try again/i.test(t), `an error is visible (panel: ${t.slice(0, 200)})`);
    }],
    ['D12b: a failed type change shows an error and keeps the previous type', async () => {
      const before = row().recording_type;
      knobs({ failPatch: true });
      $('.type-ctl').click();
      const dlg = await waitFor(() => document.querySelector('dialog[open].type-dlg, dialog[open]'), { what: 'type dialog' });
      const target = [...dlg.querySelectorAll('[data-type]')].find((x) => x.dataset.type && x.dataset.type !== before);
      target.click();
      await sleep(600);
      knobs({ failPatch: false });
      eq(row().recording_type, before, 'stored type unchanged (save failed)');
      assert(/Couldn.t save the type/.test(toastText()), `error toast still visible (toast: ${toastText()})`);
      assert(!new RegExp(target.querySelector('.type-opt-name').textContent).test($('.type-ctl').textContent) || target.dataset.type === before, `header keeps the previous type (header: ${$('.type-ctl').textContent})`);
    }],
  ]);
}
