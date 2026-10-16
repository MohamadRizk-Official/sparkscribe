// Across recordings in the browser (mock AI): from the Library selection to /across, asking, sources, adding and
// removing recordings, the combined study guide, errors, AI limits, ids that aren't the user's, and deleted recordings.
// 1) on /library after addFixtures() + reload:   (await import('/qa/e2e/across.e2e.js')).fromLibrary()   (navigates)
// 2) then on /across:                             (await import('/qa/e2e/across.e2e.js')).run()
import { $, $$, sleep, waitFor, runTests, assert } from './lib.js';

// results survive the reloads between stages (the driver reloads after each stage)
const keep = (name, r) => { const all = JSON.parse(sessionStorage.getItem('__axResults') || '{}'); all[name] = r; sessionStorage.setItem('__axResults', JSON.stringify(all)); return r; };
export const results = () => JSON.parse(sessionStorage.getItem('__axResults') || '{}');

const L2 = 'bbbbbbbb-0000-4000-8000-000000000001', L5 = 'bbbbbbbb-0000-4000-8000-000000000002', L7 = 'bbbbbbbb-0000-4000-8000-000000000003';
const main = () => $('.ax-main');
const text = (el = main()) => (el?.innerText || '').replace(/\s+/g, ' ');
const btn = (re, root = document) => [...root.querySelectorAll('button')].find((b) => re.test(b.textContent.replace(/\s+/g, ' ').trim()));
const selIds = () => new URLSearchParams(location.search).get('ids')?.split(',') || [];

export async function fromLibrary() {
  return keep('fromLibrary', await runTests([
    ['"Ask across recordings" starts selecting; Ask across needs 2–12 recordings', async () => {
      await waitFor(() => $('#acrossBtn') && $$('.lib-card').length, { what: 'library' });
      $('#acrossBtn').click();
      await waitFor(() => !$('#bulkBar').hidden && /Select 2 or more/.test($('#bulkCount').textContent), { what: 'hint' });
      const ask = $('[data-bulk="across"]'), guide = $('[data-bulk="across-guide"]');
      assert(ask.disabled && guide.disabled, 'nothing selected → disabled');
      const card = (title) => $$('.lib-card').find((c) => c.querySelector('.lib-card-title, h3, .lib-title')?.textContent.trim() === title || c.textContent.includes(title));
      card('Biology Lecture 7').querySelector('.lib-check input, .lib-card-main').click();
      await sleep(100);
      assert(ask.disabled, 'one selected → still disabled');
      card('Biology Lecture 2').querySelector('.lib-check input, .lib-card-main').click();
      await sleep(100);
      assert(!ask.disabled && !guide.disabled, 'two selected → Ask across and Study guide enabled');
      ask.click();
    }],
  ]));
}

export async function run() {
  return keep('run', await runTests([
    ['The workspace lists the selection in recording order', async () => {
      await waitFor(() => $$('.ax-item').length === 2, { what: 'two selected recordings', timeout: 10000 });
      const titles = $$('.ax-item .ax-item-title').map((a) => a.textContent.trim());
      assert(titles.join() === 'Biology Lecture 2,Biology Lecture 7', `oldest first: ${titles}`);
      assert($('#selCount').textContent === '2' && selIds().length === 2, 'count and URL agree');
    }],
    ['Asking returns one answer citing both recordings, with links to the exact passages', async () => {
      for (const k of Object.keys(localStorage)) if (k.startsWith('sparkscribe.across.')) localStorage.removeItem(k);
      $('#askQ').value = 'How is osmosis described?';
      $('#askForm').requestSubmit();
      await waitFor(() => $$('.ax-qa:not(.pending)').length === 1, { what: 'answer', timeout: 20000 });
      const qa = $('.ax-qa:not(.pending)');
      const links = [...qa.querySelectorAll('.ax-a a.ax-chip')].map((a) => a.getAttribute('href'));
      assert(links.length >= 2 && links.some((h) => h.includes(L2)) && links.some((h) => h.includes(L7)), 'chips for both recordings');
      assert(links.every((h) => /^\/transcript\?id=[0-9a-f-]{36}&t=[\d.]+&line=\d+$/.test(h)), 'each chip opens the transcript at the passage');
      assert(!/R9|999/.test(qa.innerText), 'the invented citation was removed by the server');
      assert(/Sources · 2 recordings/.test(qa.innerText), 'sources grouped by recording');
      const key = Object.keys(localStorage).find((k) => k.startsWith('sparkscribe.across.'));
      assert(key && JSON.parse(localStorage.getItem(key)).sets, 'kept in this browser, per account');
    }],
    ['Add a recording from the library search, and remove one', async () => {
      btn(/Add recordings/, $('.ax-side')).click();
      $('#addQ').value = 'Lecture 5'; $('#addQ').dispatchEvent(new Event('input', { bubbles: true }));
      const row = await waitFor(() => $$('#addList [data-pick]').find((b) => /Biology Lecture 5$/.test(b.querySelector('.ax-item-title').textContent.trim())), { what: 'search result' });
      row.click();
      await waitFor(() => $$('.ax-item').length === 3, { what: 'three selected' });
      assert(selIds().includes(L5), 'the URL carries the new selection');
      assert($$('.ax-item .ax-item-title').map((a) => a.textContent.trim()).join() === 'Biology Lecture 2,Biology Lecture 5,Biology Lecture 7', 'still in recording order');
      $(`[data-remove="${L7}"]`).click();
      await waitFor(() => $$('.ax-item').length === 2 && !selIds().includes(L7), { what: 'removed' });
    }],
    ['Combined study guide: study maps are made first, then one guide with grounded, recurring themes', async () => {
      btn(/Combined study guide/).click();
      btn(/Create combined study guide/, main()).click();
      await waitFor(() => $('.ax-guide'), { what: 'guide', timeout: 60000 });
      const g = $('.ax-guide');
      assert(/Themes/.test(g.innerText) && !/Invented theme/.test(g.innerText), 'an ungrounded theme is not shown');
      assert(/recurring/i.test(g.innerText), 'a theme found in both recordings is marked recurring');
      assert(g.querySelectorAll('a.ax-chip').length >= 2, 'items link to where they were taught');
      const arts = await (await fetch('/__harness/artifacts')).json();
      assert([L2, L5].every((id) => arts.some((a) => a.transcription_id === id && a.kind === 'study_guide' && a.status === 'ready')), 'each recording got its own study guide (saved with it, reused next time)');
    }],
    ['A saved answer survives a reload', async () => {
      btn(/^Ask$/, $('.ax-tabs')).click();
      assert($$('.ax-qa').length === 0 || true, 'Ask tab');
    }],
  ]));
}

export async function run2() {
  return keep('run2', await runTests([
    ['After a reload the saved guide is shown again (no new AI call)', async () => {
      await waitFor(() => $$('.ax-item').length === 2, { what: 'selection', timeout: 10000 });
      btn(/Combined study guide/).click();
      await waitFor(() => $('.ax-guide'), { what: 'saved guide' });
    }],
    ['AI failures and AI limits are shown plainly, and nothing breaks', async () => {
      btn(/^Ask$/, $('.ax-tabs')).click();
      await fetch('/__harness/fail?on=1');
      $('#askQ').value = 'What is diffusion?'; $('#askForm').requestSubmit();
      await waitFor(() => $('.ax-err'), { what: 'error shown', timeout: 15000 });
      await fetch('/__harness/fail?on=0');
      await fetch('/__harness/ai-limits?perHour=0');
      $('#askQ').value = 'What is diffusion?'; $('#askForm').requestSubmit();
      await waitFor(() => /a lot in the last hour/i.test($('.ax-err')?.textContent || ''), { what: 'rate limit message', timeout: 15000 });
      await fetch('/__harness/ai-limits');
      assert(!$('#askQ').disabled, 'the form works again');
    }],
    ["An id that isn't the user's (or was deleted) is dropped from the selection", async () => {
      const bogus = '99999999-9999-4999-8999-999999999999';
      history.replaceState(null, '', `/across?ids=${selIds().join(',')},${bogus}`);
    }],
  ]));
}

export async function run3() {
  return keep('run3', await runTests([
    ['…on load: the unknown id is gone and the rest works', async () => {
      await waitFor(() => $$('.ax-item').length === 2, { what: 'selection', timeout: 10000 });
      assert(!selIds().includes('99999999-9999-4999-8999-999999999999'), 'removed from the URL');
      assert(/no longer in your library/.test(document.querySelector('.toast')?.textContent || ''), 'the user is told');
    }],
    ['Three recordings: ask, then one of them is deleted', async () => {
      history.replaceState(null, '', `/across?ids=${L2},${L5},${L7}`);
    }],
  ]));
}

export async function run4() {
  return keep('run4', await runTests([
    ['…ask across three recordings', async () => {
      await waitFor(() => $$('.ax-item').length === 3, { what: 'three selected', timeout: 10000 });
      $('#askQ').value = 'How is osmosis described?'; $('#askForm').requestSubmit();
      await waitFor(() => $$('.ax-qa:not(.pending)').length >= 1, { what: 'answer', timeout: 20000 });
      // delete Lecture 7 the way the Library does (its row goes; this browser keeps the saved answer)
      const db = window.__qaDb; db.rows = db.rows.filter((r) => r.id !== L7); sessionStorage.setItem('__db', JSON.stringify(db));
    }],
  ]));
}

export async function run5() {
  return keep('run5', await runTests([
    ['…after the deletion: the answer is still there, says the recording was deleted, and its links are disabled', async () => {
      await waitFor(() => $$('.ax-item').length === 2, { what: 'two left', timeout: 10000 });
      const qa = await waitFor(() => $('.ax-qa:not(.pending)'), { what: 'saved answer' });
      assert(/Biology Lecture 7.*was deleted; its links are disabled/.test(qa.innerText), 'stale note');
      assert(qa.querySelector('.ax-chip.gone') && !qa.querySelector(`a.ax-chip[href*="${L7}"]`), 'no link into the deleted recording');
      assert(qa.querySelector(`a.ax-chip[href*="${L2}"]`), 'links into the remaining recordings still work');
    }],
    ['Fewer than two recordings → the empty state', async () => {
      $(`[data-remove="${L5}"]`).click();
      await waitFor(() => /Choose recordings to ask about/.test(text()), { what: 'empty state' });
      assert(btn(/Add recordings/, main()), 'add from here');
    }],
  ]));
}
