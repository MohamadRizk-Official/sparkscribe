// Create organisation (mock AI): Study / Work / Specialized groups with All tools, recommendations by recording type,
// one Draft entry for both drafts, coverage and caution notes on study results, Summary kept current after a rename.
// Run on /transcript?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa (a 3-person meeting) with a fresh harness.
import { $, $$, sleep, waitFor, runTests, assert } from './lib.js';

const tab = (name) => { const b = [...$$('#resTabs [role="tab"], #resTabs button')].find((x) => new RegExp(name, 'i').test(x.textContent)); assert(b, `tab ${name}`); b.click(); };
const panel = () => $('#insightsHost [data-panel="create"]');
const text = (el = panel()) => (el?.innerText || '').replace(/\s+/g, ' ');
const btn = (re, root = panel()) => [...(root?.querySelectorAll('button') || [])].find((b) => re.test(b.textContent.trim()));
const toastText = () => $('.toast')?.textContent || '';
const landing = async () => {
  tab('Create');
  const back = btn(/^(← )?All tools$|^Create$/);
  if (back) { back.click(); await sleep(120); }
  await waitFor(() => panel().querySelector('.create'), { what: 'Create landing' });
};

export async function run() {
  return runTests([
    ['All tools are grouped as Study / Work / Specialized, with Export', async () => {
      await landing();
      const groups = [...panel().querySelectorAll('.create-group')].map((g) => [g.getAttribute('aria-label'), [...g.querySelectorAll('.ctool-name')].map((n) => n.textContent)]);
      assert(JSON.stringify(groups) === JSON.stringify([['Study', ['Study Guide', 'Flashcards', 'Practice Quiz']], ['Work', ['Meeting Recap', 'Action Plan', 'Draft']], ['Specialized', ['Interview Q&A', 'Episode Notes']]]), `groups: ${JSON.stringify(groups)}`);
      assert(panel().querySelector('[data-tool="export"]'), 'Export is still offered');
      assert(!panel().querySelector('[data-tool="followup_email"], [data-tool="reply_draft"]'), 'the two draft tools are one Draft entry');
    }],
    ['A meeting recommends Meeting Recap, Action Plan and Draft', async () => {
      const rec = [...panel().querySelectorAll('.create-grid.rec .ctool-name')].map((n) => n.textContent);
      assert(rec.join() === 'Meeting Recap,Action Plan,Draft', `recommended: ${rec}`);
    }],
    ['Draft asks what to draft, keeps both kinds, and can switch between them', async () => {
      panel().querySelector('.create-grid.rec [data-tool="draft"]').click();
      const dlg = await waitFor(() => document.querySelector('dialog[open].draft-dlg'), { what: 'draft chooser' });
      const picks = [...dlg.querySelectorAll('.draft-pick b')].map((b) => b.textContent);
      assert(picks.join() === 'A follow-up email,A reply', `choices: ${picks} (a meeting suggests the email first)`);
      [...dlg.querySelectorAll('.draft-pick')].find((b) => /A reply/.test(b.textContent)).click();
      const setup = await waitFor(() => document.querySelector('dialog[open].setup-dlg:not(.draft-dlg)'), { what: 'reply setup' });
      assert(/Draft a reply/.test(setup.innerText), 'the reply setup opens');
      setup.querySelector('[data-act=cancel]').click();
      await waitFor(() => /Drafting a reply\./.test(text()), { what: 'reply tool view' });
      btn(/Draft an email instead/).click();
      const s2 = await waitFor(() => document.querySelector('dialog[open].setup-dlg:not(.draft-dlg)'), { what: 'email setup' });
      assert(/follow-up email/i.test(s2.innerText), 'switching opens the email setup');
      s2.querySelector('[data-act=cancel]').click();
    }],
    ['Study results say how much of the recording they cover, and label names not in the transcript', async () => {
      await landing();
      [...panel().querySelectorAll('[data-tool="flashcards"]')][0].click();
      await sleep(150);
      const create = btn(/^Create Flashcards$|^Create improved version$/);
      create?.click();
      await waitFor(() => panel().querySelector('.fc'), { timeout: 15000, what: 'deck' });
      assert(/Covers all 1 main topic/.test(text()), `coverage note (panel: ${text().slice(0, 300)})`);
      // the mock's "Mock School" is not in the transcript: the card that uses it carries a note
      let found = false;
      for (let i = 0; i < 4 && !found; i++) {
        found = /Spelling not found in the transcript/.test(text());
        if (!found) { btn(/Next →/)?.click(); await sleep(80); }
      }
      assert(found, 'a card with a name the transcript lacks is labelled');
    }],
    ['A plain rename keeps the Summary current (no "out of date", no new generation)', async () => {
      tab('Summary');
      const make = await waitFor(() => [...$$('#insightsHost button')].find((b) => /Summarize/.test(b.textContent)) || ($('.sum-tldr') && 'done'), { what: 'summarize' });
      if (make !== 'done') make.click();
      await waitFor(() => $('.sum-tldr'), { timeout: 15000, what: 'summary' });
      $$('#transcript .grp')[0].querySelector('button.who').click();
      const r = await waitFor(() => [...($('.menu')?.querySelectorAll('button') || [])].find((x) => /^Rename .* everywhere/.test(x.textContent)), { what: 'rename item' });
      r.click();
      const dlg = await waitFor(() => document.querySelector('dialog[open]'), { what: 'rename dialog' });
      dlg.querySelector('input').value = 'Chair'; dlg.querySelector('form').requestSubmit();
      await waitFor(() => /saved/.test(toastText()), { what: 'rename saved' });
      tab('Summary');
      await sleep(400);
      assert(!/out of date/i.test(text($('#insightsHost'))), 'no out-of-date banner after a rename');
    }],
  ]);
}
