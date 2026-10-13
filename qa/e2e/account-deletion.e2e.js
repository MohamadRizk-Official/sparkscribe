// Settings → Delete account (harness: mocked auth + the delete_my_account RPC with the same guards as the proposed
// SQL). Guards, failures that delete nothing, and a successful deletion that clears this browser and signs out.
// Run on /settings after a fresh harness start; the last test deletes the (mock) account, so run it last.
import { $, sleep, waitFor, knobs, dbRows, runTests, assert, eq } from './lib.js';

const dlg = () => document.querySelector('dialog[open].delete-account-dlg');
const errText = () => dlg()?.querySelector('.dlg-err:not([hidden])')?.textContent || '';
const type = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
async function open() {
  if (dlg()) dlg().querySelector('[data-act=cancel]').click();
  await waitFor(() => !dlg(), { what: 'previous dialog closed' });
  (await waitFor(() => $('#deleteAccountBtn'), { what: 'Delete account button' })).click();
  return waitFor(dlg, { what: 'delete dialog' });
}
async function attempt(password) {
  const d = await open();
  type(d.querySelector('[name=password]'), password);
  type(d.querySelector('[name=confirm]'), 'DELETE');
  d.querySelector('form').requestSubmit();
  await waitFor(() => errText() || !dlg() || /deleted/.test(location.search), { timeout: 8000, what: 'a result' });
  return errText();
}

export async function run() {
  const rowsAtStart = dbRows().length;
  localStorage.setItem('sparkscribe.pendingSave', JSON.stringify({ title: 'private unsaved meeting', at: Date.now() }));
  localStorage.setItem('sparkscribe.theme', 'light');
  return runTests([
    ['the dialog says what is deleted, and Delete stays off until the password and DELETE are entered', async () => {
      const d = await open();
      assert(/every saved transcript/.test(d.textContent) && /can.t be undone/.test(d.textContent) && /never uploaded/.test(d.textContent), 'explains what goes and that it is permanent');
      const go = d.querySelector('[type=submit]');
      assert(go.disabled, 'off at first');
      type(d.querySelector('[name=confirm]'), 'DELETE'); assert(go.disabled, 'still off without a password');
      type(d.querySelector('[name=password]'), 'x'); type(d.querySelector('[name=confirm]'), 'delete'); assert(go.disabled, 'lower-case "delete" is not enough');
      type(d.querySelector('[name=confirm]'), ' DELETE '); assert(!go.disabled, 'on with both');
      d.dispatchEvent(new Event('cancel')); await waitFor(() => !dlg(), { what: 'Esc closes' });
      eq(dbRows().length, rowsAtStart, 'nothing deleted by cancelling');
    }],
    ['a wrong password deletes nothing and asks again', async () => {
      const msg = await attempt('wrong-password');
      assert(/password isn.t right/.test(msg), `message: ${msg}`);
      eq(dlg().querySelector('[name=password]').value, '', 'password field cleared');
      eq(dbRows().length, rowsAtStart, 'library intact');
    }],
    ['an active paid plan blocks deletion with a clear next step', async () => {
      knobs({ deleteReason: 'subscription' });
      const msg = await attempt('right-password');
      knobs({ deleteReason: '' });
      assert(/paid plan .*Cancel it first/.test(msg), `message: ${msg}`);
      eq(dbRows().length, rowsAtStart, 'library intact');
    }],
    ['flag on before the migration: says deleting is not switched on, nothing deleted', async () => {
      knobs({ deleteMissing: true });
      const msg = await attempt('right-password');
      knobs({ deleteMissing: false });
      assert(/isn.t switched on yet\. Nothing was deleted/.test(msg), `message: ${msg}`);
      eq(dbRows().length, rowsAtStart, 'library intact');
    }],
    ['a server failure says nothing was removed', async () => {
      knobs({ failDelete: true });
      const msg = await attempt('right-password');
      knobs({ failDelete: false });
      assert(/nothing was removed/.test(msg), `message: ${msg}`);
      eq(dbRows().length, rowsAtStart, 'library intact');
      assert(localStorage.getItem('sparkscribe.pendingSave'), 'this browser is not cleared when deletion failed');
    }],
  ]);
}

// then: deleteNow() submits for real (the page reloads to /settings?deleted=1), then afterRedirect() on the new page
export async function deleteNow() {
  sessionStorage.setItem('__qaRowsBefore', String(dbRows().length));
  attempt('right-password');
  return 'submitted';
}
export async function afterRedirect() {
  return runTests([
    ['success: the account is deleted, this browser forgets it, and /settings says so', async () => {
      await waitFor(() => /Your account was deleted/.test($('#accountBody')?.textContent || ''), { what: 'deleted notice' });
      assert(sessionStorage.getItem('__accountDeleted'), 'the delete call was made');
      assert(Number(sessionStorage.getItem('__qaRowsBefore')) > 0 && dbRows().length === 0, `library emptied (mock): ${sessionStorage.getItem('__qaRowsBefore')} → ${dbRows().length}`);
      eq(localStorage.getItem('sparkscribe.pendingSave'), null, 'the unsaved transcript kept in this browser is gone');
      eq(localStorage.getItem('sparkscribe.theme'), 'light', 'device theme kept');
      assert(!Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k)), 'signed out (no stored session)');
      assert(!$('#deleteAccountBtn') && !$('#signOutBtn'), 'no account buttons');
      eq(location.search, '', 'the ?deleted flag is removed from the address');
    }],
  ]);
}
