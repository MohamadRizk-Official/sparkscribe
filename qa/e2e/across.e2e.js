// Across recordings in the browser (mock AI): from the Library selection to /across, asking, sources, adding and
// removing recordings, the combined study guide, errors, AI limits, ids that aren't the user's, and deleted recordings.
// 1) on /library after addFixtures(), __qaKnobs({ plan: 'free' }) + reload:  (await import('/qa/e2e/across.e2e.js')).fromLibrary()   (navigates)
// 2) on /across (still Free):   gate()   — then __qaKnobs({ plan: 'thunder' }) + reload
// 3) run(), reload, run2(), reload, run3(), reload, run4(), reload, run5()
// Answers and guides are saved by the server (the harness store stands in for public.across_items).
import { $, $$, sleep, waitFor, runTests, assert, eq } from './lib.js';

// results survive the reloads between stages (the driver reloads after each stage)
const keep = (name, r) => { const all = JSON.parse(sessionStorage.getItem('__axResults') || '{}'); all[name] = r; sessionStorage.setItem('__axResults', JSON.stringify(all)); return r; };
export const results = () => JSON.parse(sessionStorage.getItem('__axResults') || '{}');

const L2 = 'bbbbbbbb-0000-4000-8000-000000000001', L5 = 'bbbbbbbb-0000-4000-8000-000000000002', L7 = 'bbbbbbbb-0000-4000-8000-000000000003';
const main = () => $('.ax-main');
const text = (el = main()) => (el?.innerText || '').replace(/\s+/g, ' ');
const btn = (re, root = document) => [...root.querySelectorAll('button')].find((b) => re.test(b.textContent.replace(/\s+/g, ' ').trim()));
const selIds = () => new URLSearchParams(location.search).get('ids')?.split(',') || [];

const saved = async () => (await fetch('/__harness/across')).json();
const ledger = async () => (await (await fetch('/__harness/ai-limits')).json()).ledger.length;
const api = (body) => fetch('/api/across', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dev-harness': '1' }, body: JSON.stringify(body) });

export async function fromLibrary() {
  return keep('fromLibrary', await runTests([
    ['The Library labels asking across recordings as a Thunder feature (Free plan)', async () => {
      await waitFor(() => $('#acrossBtn'), { what: 'library' });
      await sleep(300);
      assert($('#acrossTag') && !$('#acrossTag').hidden && /Thunder/.test($('#acrossTag').textContent), 'Thunder tag shown');
    }],
    ['Free: "Ask across recordings" explains Thunder with an example and leads to Pricing (Thunder highlighted, no checkout)', async () => {
      $('#acrossBtn').click();
      const dlg = await waitFor(() => $('dialog.thunder-dlg[open]'), { what: 'Thunder explanation' });
      assert(/Connect the dots/.test(dlg.innerText) && dlg.querySelector('.th-example'), 'title and example');
      eq(dlg.querySelector('.th-cta').getAttribute('href'), '/pricing?highlight=thunder&next=%2Flibrary', 'Explore Thunder');
      assert(document.activeElement === dlg.querySelector('.th-cta'), 'focus on the action');
      assert($('#bulkBar').hidden, 'no selection started');
      dlg.querySelector('[data-act="cancel"]').click();
      await waitFor(() => !$('dialog.thunder-dlg[open]'), { what: 'closed' });
    }],
    ['Selecting in the Library; Ask across needs 2–12 recordings', async () => {
      await waitFor(() => $('#selectBtn') && $$('.lib-card').length, { what: 'library' });
      $('#selectBtn').click();
      await waitFor(() => !$('#bulkBar').hidden, { what: 'selection bar' });
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

// Free: the page explains Thunder and keeps the selection; nothing is generated; the API refuses before any AI call
export async function gate() {
  return keep('gate', await runTests([
    ['Free: the selection is kept, and Ask explains Thunder instead of asking', async () => {
      await waitFor(() => $$('.ax-item').length === 2, { what: 'selection', timeout: 10000 });
      const locked = await waitFor(() => $('#askPanel .ax-locked'), { what: 'Thunder panel' });
      assert(!$('#askForm'), 'no question form');
      const a = locked.querySelector('a.th-cta[href^="/pricing?highlight=thunder&next="]');
      assert(a && decodeURIComponent(a.getAttribute('href')).includes(`/across?ids=${selIds().join(',')}`), 'Explore Thunder, coming back to this selection');
      assert(locked.querySelector('.thunder-mark') && locked.querySelector('.th-example'), 'Thunder mark and an example');
      btn(/Combined study guide/).click();
      await waitFor(() => $('#guidePanel .ax-locked'), { what: 'guide explains Thunder too' });
      assert(!btn(/Create combined study guide/, main()), 'no create button');
      btn(/^Ask$/, $('.ax-tabs')).click();
    }],
    ['Free: a direct request is refused (403 plan_required: Thunder) before anything is read or reserved', async () => {
      const n = await ledger();
      const r = await api({ action: 'ask', ids: selIds(), question: 'How is osmosis described?' });
      const b = await r.json();
      assert(r.status === 403 && b.error === 'plan_required' && b.details.plan === 'thunder', `${r.status} ${b.error}`);
      const g = await api({ action: 'guide', ids: selIds() });
      assert(g.status === 403, 'guide refused too');
      assert((await ledger()) === n && (await saved()).length === 0, 'no AI usage, nothing saved');
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
      $('#askQ').value = 'How is osmosis described?';
      $('#askForm').requestSubmit();
      await waitFor(() => $$('.ax-qa:not(.pending)').length === 1, { what: 'answer', timeout: 20000 });
      const qa = $('.ax-qa:not(.pending)');
      const links = [...qa.querySelectorAll('.ax-a a.ax-chip')].map((a) => a.getAttribute('href'));
      assert(links.length >= 2 && links.some((h) => h.includes(L2)) && links.some((h) => h.includes(L7)), 'chips for both recordings');
      assert(links.every((h) => /^\/transcript\?id=[0-9a-f-]{36}&t=[\d.]+&line=\d+$/.test(h)), 'each chip opens the transcript at the passage');
      assert(!/R9|999/.test(qa.innerText), 'the invented citation was removed by the server');
      assert(/Sources · 2 recordings/.test(qa.innerText), 'sources grouped by recording');
      const rows = await saved();
      assert(rows.length === 1 && rows[0].question === 'How is osmosis described?' && /\{\{R\d\}\}/.test(rows[0].content.answer), 'saved to the account by the server, with tokens (not names)');
      assert(!Object.keys(localStorage).some((k) => k.startsWith('sparkscribe.across.')), 'nothing kept in this browser');
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
    ['(setup for the next stage: the first recording is renamed elsewhere)', async () => {
      btn(/^Ask$/, $('.ax-tabs')).click();
      const row = window.__qaDb.rows.find((r) => r.id === L2);
      row.title = 'Bio 2 — osmosis intro';
      sessionStorage.setItem('__db', JSON.stringify(window.__qaDb));
      await fetch('/__harness/seed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(row) });
    }],
  ]));
}

export async function run2() {
  return keep('run2', await runTests([
    ['After a reload (nothing kept in this browser) the saved guide is shown again, no new AI call', async () => {
      await waitFor(() => $$('.ax-item').length === 2, { what: 'selection', timeout: 10000 });
      const n = await ledger();
      btn(/Combined study guide/).click();
      const g = await waitFor(() => $('.ax-guide'), { what: 'saved guide' });
      assert((await ledger()) === n, 'read from the account, not generated again');
      assert(/Bio 2 — osmosis intro/.test(g.innerText) && !/Biology Lecture 2/.test(g.querySelector('.ax-key').innerText), 'the renamed recording shows its new title');
      btn(/^Ask$/, $('.ax-tabs')).click();
    }],
    ['A question asked on another device appears when this tab comes back; one deleted there disappears', async () => {
      const before = $$('.ax-qa:not(.pending)').length;
      const r = await api({ action: 'ask', ids: selIds(), question: 'What do these say about diffusion?', requestId: crypto.randomUUID() });
      assert(r.ok, 'the other device asked');
      await sleep(5200);
      window.dispatchEvent(new Event('focus'));
      await waitFor(() => $$('.ax-qa:not(.pending)').length === before + 1, { what: 'new answer synced', timeout: 10000 });
      const chips = $$('.ax-qa a.ax-chip').map((a) => a.textContent);
      assert(chips.some((t) => /Bio 2 — osmosis intro/.test(t)) && chips.every((t) => !/Biology Lecture 2/.test(t)), 'sources show the current title');
      const id = (await saved()).find((x) => x.question === 'What do these say about diffusion?').id;
      assert((await (await api({ action: 'delete', id })).json()).deleted, 'deleted on the other device');
      await sleep(5200);
      window.dispatchEvent(new Event('focus'));
      await waitFor(() => $$('.ax-qa:not(.pending)').length === before, { what: 'deletion synced', timeout: 10000 });
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
      // delete Lecture 7 the way the Library does: its row goes (in the browser's view and on the server)
      const db = window.__qaDb; db.rows = db.rows.filter((r) => r.id !== L7); sessionStorage.setItem('__db', JSON.stringify(db));
      await fetch(`/__harness/delete-recording?id=${L7}`);
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
    ['Deleting an answer here removes it from the account', async () => {
      const n = (await saved()).length;
      const orig = window.confirm; window.confirm = () => true;
      $('.ax-qa:not(.pending) [data-del]').click();
      window.confirm = orig;
      for (let i = 0; i < 40 && (await saved()).length !== n - 1; i++) await sleep(200);
      assert((await saved()).length === n - 1, 'deleted on the server');
    }],
    ['Fewer than two recordings → the empty state', async () => {
      $(`[data-remove="${L5}"]`).click();
      await waitFor(() => /Choose recordings to ask about/.test(text()), { what: 'empty state' });
      assert(btn(/Add recordings/, main()), 'add from here');
    }],
  ]));
}
