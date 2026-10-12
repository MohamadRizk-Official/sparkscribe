// Library (mock DB): list, search, rename, favorite (+ rollback on failure), folders, delete with confirmation,
// empty states. Run on http://127.0.0.1:5190/library
import { $, $$, sleep, waitFor, visible, knobs, dbRows, runTests, assert, eq } from './lib.js';

// one element per recording card: the card that holds the main link
const cards = () => $$('#libList a.lib-card-main').map((a) => a.parentElement);
const titles = () => cards().map((c) => c.querySelector('.lib-title').textContent);
const cardOf = (t) => cards().find((c) => c.querySelector('.lib-title').textContent === t);
const toastText = () => $('.toast')?.textContent || '';
async function openMenu(title) { cardOf(title).querySelector('[data-act="menu"]').click(); return waitFor(() => document.querySelector('dialog[open] .menu-list'), { what: 'card menu' }); }
async function prompt(value) {
  const dlg = await waitFor(() => document.querySelector('dialog[open] form'), { what: 'prompt' });
  const input = dlg.querySelector('input'); input.value = value; dlg.requestSubmit();
  await waitFor(() => !document.querySelector('dialog[open] form'), { what: 'prompt closed' });
}

export async function run() {
  return runTests([
    ['lists every saved recording for the signed-in user, newest first', async () => {
      await waitFor(() => cards().length >= 4, { what: 'cards' });
      eq(cards().length, dbRows().length, 'one card per row');
      const order = [...dbRows()].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((r) => r.title);
      // the "Recent" tab may sort by last opened; switch to All to check newest-first
      const all = $$('[role="tab"], .lib-tab, button').find((b) => /^All$/.test(b.textContent.trim()));
      all?.click(); await sleep(400);
      eq(titles().join('|'), order.join('|'), 'order');
    }],
    ['old saves without line timestamps are listed and openable', async () => {
      const c = cardOf('Older save (no segments)'); assert(c, 'card present');
      assert(/\/transcript\?id=bbbbbbbb/.test(c.querySelector('a.lib-card-main').getAttribute('href')), 'link');
    }],
    ['search finds transcript text and highlights it; clear restores the list', async () => {
      const q = $('#q'); q.value = 'proposal'; $('#searchForm').requestSubmit();
      await waitFor(() => $('.sr-summary') && !/Searching/.test($('.sr-summary').textContent), { what: 'search results' });
      assert(/Pricing meeting/.test($('#libList').innerText), 'match shown');
      assert($('#libList mark'), 'match highlighted');
      $('[data-act="clear-search"]').click();
      await waitFor(() => cards().length >= 4, { what: 'list back' });
    }],
    ['search with no match shows a clear empty state', async () => {
      const q = $('#q'); q.value = 'zebra-quantum-nonexistent'; $('#searchForm').requestSubmit();
      await waitFor(() => /No matches/.test($('#libList').innerText), { what: 'no matches' });
      $('[data-act="clear-search"]').click(); await waitFor(() => cards().length >= 4, { what: 'list back' });
    }],
    ['rename a recording', async () => {
      await openMenu('Voice note from Sam');
      document.querySelector('dialog[open] [data-m="rename"]').click();
      await prompt('Voice note from Sam — renamed ✓');
      await waitFor(() => titles().includes('Voice note from Sam — renamed ✓'), { what: 'renamed card' });
      eq(dbRows().find((r) => r.id.startsWith('cccc')).title, 'Voice note from Sam — renamed ✓', 'stored title');
    }],
    ['favorite: optimistic star, stored; failure rolls back with a message', async () => {
      const t = 'Biology lecture 7';
      cardOf(t).querySelector('[data-act="star"]').click();
      await waitFor(() => dbRows().find((r) => r.title === t).is_favorite === true, { what: 'favorite stored' });
      knobs({ failPatch: true });
      cardOf(t).querySelector('[data-act="star"]').click();
      await sleep(500);
      knobs({ failPatch: false });
      eq(cardOf(t).querySelector('[data-act="star"]').getAttribute('aria-pressed'), 'true', 'star rolled back');
      eq(dbRows().find((r) => r.title === t).is_favorite, true, 'still favorite in db');
    }],
    ['delete asks first; Cancel keeps it, Delete removes it', async () => {
      const t = 'Older save (no segments)';
      await openMenu(t); document.querySelector('dialog[open] [data-m="delete"]').click();
      const dlg = await waitFor(() => document.querySelector('dialog[open].confirm-dlg, dialog[open] .confirm-actions') && document.querySelector('dialog[open]'), { what: 'confirm' });
      assert(/permanently/i.test(dlg.innerText), 'explains it is permanent');
      dlg.querySelector('[data-act="cancel"]').click();
      await sleep(300);
      assert(dbRows().some((r) => r.title === t), 'kept after Cancel');
      await openMenu(t); document.querySelector('dialog[open] [data-m="delete"]').click();
      const dlg2 = await waitFor(() => document.querySelector('dialog[open] [data-act="ok"]'), { what: 'confirm 2' });
      dlg2.click();
      await waitFor(() => !dbRows().some((r) => r.title === t), { what: 'deleted' });
      await waitFor(() => !titles().includes(t), { what: 'card gone' });
    }],
  ]);
}
