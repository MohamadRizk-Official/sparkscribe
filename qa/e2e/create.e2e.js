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
    ['Every tool is offered exactly once: recommended first, the rest grouped (Study / Work / Specialized), plus Export', async () => {
      await landing();
      const groups = [...panel().querySelectorAll('.cr-browser .cr-group')].map((g) => [g.querySelector('.cr-group-h').textContent, [...g.querySelectorAll('.ctool-name')].map((n) => n.textContent)]);
      assert(JSON.stringify(groups) === JSON.stringify([['Study', ['Study Guide', 'Flashcards', 'Practice Quiz']], ['Specialized', ['Interview Q&A', 'Episode Notes']], ['Export', ['Export']]]), `groups: ${JSON.stringify(groups)}`);
      const names = [...panel().querySelectorAll('[data-tool]')].map((b) => b.dataset.tool);
      assert(new Set(names).size === names.length, `no tool appears twice: ${names}`);
      assert(!panel().querySelector('[data-tool="followup_email"], [data-tool="reply_draft"]'), 'the two draft tools are one Draft entry');
      const big = [...panel().querySelectorAll('.cr-rec .ctool.big')];
      assert(big.length && big.every((c) => /Example/i.test(c.querySelector('.cr-doc-bar em')?.textContent || '')), 'every recommended preview is labelled as an example');
      assert(!panel().querySelector('.cr-browser .cr-sample, .cr-browser .cr-doc, .cr-peek'), 'More tools: compact rows, no example previews');
      // every arrow has room for its hover move (+4px) inside its row (2026-10-22: a 30px circle in an 18px column was clipped)
      for (const row of panel().querySelectorAll('.cr-row')) {
        const r = row.getBoundingClientRect(), g = row.querySelector('.ctool-go').getBoundingClientRect(), a = row.querySelector('.ctool-go svg').getBoundingClientRect();
        assert(g.right <= r.right && a.right + 4 <= g.right, `${row.dataset.tool}: arrow ${Math.round(a.right)} / area ${Math.round(g.right)} / row ${Math.round(r.right)}`);
      }
      assert(getComputedStyle(document.getElementById('resTabs')).borderBottomLeftRadius === getComputedStyle(document.getElementById('resTabs')).borderTopLeftRadius, 'tab bar: all four corners match');
    }],
    ['A meeting recommends Meeting Recap, Action Plan and Draft', async () => {
      const rec = [...panel().querySelectorAll('.cr-rec .ctool-name')].map((n) => n.textContent);
      assert(rec.join() === 'Meeting Recap,Action Plan,Draft', `recommended: ${rec}`);
    }],
    ['One click starts a tool that needs no input', async () => {
      panel().querySelector('.cr-rec [data-tool="meeting_recap"]').click();
      await waitFor(() => panel().querySelector('.tool-view') && /Meeting Recap/.test(text()), { what: 'tool view' });
      await waitFor(() => panel().querySelector('.tool-body'), { timeout: 15000, what: 'recap generated without a second click' });
      await landing();
    }],
    ['Draft asks what to draft, keeps both kinds, and can switch between them', async () => {
      panel().querySelector('.cr-rec [data-tool="draft"]').click();
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
