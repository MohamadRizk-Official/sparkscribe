// Settings: Account (who you're signed in as), Preferences (the mascot), Privacy (how your data is handled).
// Works signed out too: preferences are kept in this browser, and on the account when signed in.
import { mountAccountMenu, getSession, signOut, esc, deleteMyAccount } from '../lib/account.js';
import { makeDialog } from '../library/dialogs.js';
import { getMascotPref, setMascotPref, getThemePref, setThemePref } from '../lib/prefs.js';
import { mountMascot } from '../mascot/mascot.js';
import { keepAudioPref, setKeepAudioPref, audioStorageInfo, clearAllAudio, fmtBytes } from '../lib/audio-store.js';

const $ = (id) => document.getElementById(id);
let signedIn = false;

// ---------- account ----------
function renderAccount(session) {
  signedIn = !!session;
  const body = $('accountBody');
  if (!session) {
    body.innerHTML = justDeleted
      ? `<div class="set-row-text" role="status"><h3>Your account was deleted</h3><p>Your transcripts, everything made from them, your folders and your sign-in have been removed. Thanks for trying SparkScribe.</p></div>`
      : `<div class="set-row-text"><h3>Not signed in</h3><p>Sign in to save transcripts to My Library and keep your preferences on every device.</p></div>
      <a class="btn btn-primary" href="/auth?next=%2Fsettings">Sign in</a>`;
    showSaved();
    return;
  }
  const u = session.user, meta = u.user_metadata || {};
  const name = meta.full_name || meta.name || '';
  body.innerHTML = `<div class="set-who"><b>${esc(name || u.email || 'Signed in')}</b>${name ? `<span>${esc(u.email || '')}</span>` : ''}</div>
    <div class="set-actions"><a class="btn btn-ghost" href="/library">My Library</a><button class="btn btn-ghost" type="button" id="signOutBtn">Sign out</button></div>
    ${DELETION_ON ? `<div class="set-danger"><div class="set-row-text"><h3>Delete account</h3><p>Permanently delete your account and everything saved in it.</p></div>
      <button class="btn btn-danger" type="button" id="deleteAccountBtn">Delete account…</button></div>` : ''}`;
  $('signOutBtn').addEventListener('click', async () => { await signOut(); location.reload(); });
  $('deleteAccountBtn')?.addEventListener('click', () => openDeleteDialog(u));
  showSaved();
}

// ---------- delete account ----------
// What goes, said plainly; the password and the typed word guard against a slip or someone else at this computer.
// Shown only once the database function exists (supabase/proposed/*_account_deletion.sql): set VITE_ACCOUNT_DELETION=1
// in the same release that applies the migration.
const DELETION_ON = import.meta.env.VITE_ACCOUNT_DELETION === '1';
const justDeleted = new URLSearchParams(location.search).has('deleted');
if (justDeleted) history.replaceState(null, '', '/settings');
function openDeleteDialog(user) {
  const hasPassword = (user.app_metadata?.providers || [user.app_metadata?.provider]).includes('email');
  const { dlg, dismiss } = makeDialog('delete-account-dlg', `
    <form class="dlg-form" novalidate>
      <h3>Delete your account?</h3>
      <div class="dlg-body">
        <p>This permanently deletes:</p>
        <ul class="dlg-list"><li>every saved transcript and its speaker names</li><li>summaries, notes, insights and Ask answers</li><li>everything made in Create (study guides, quizzes, recaps…)</li><li>your folders and preferences</li><li>your sign-in${user.email ? ` (${esc(user.email)})` : ''}</li></ul>
        <p class="dlg-dim">A paid plan is canceled right away, so you won’t be charged again. It can’t be undone, and we can’t restore it. Your audio was never uploaded. Files you exported stay on your devices.</p>
      </div>
      ${hasPassword ? '<label class="dlg-field"><span>Your password</span><input type="password" name="password" autocomplete="current-password" required /></label>' : ''}
      <label class="dlg-field"><span>Type DELETE to confirm</span><input type="text" name="confirm" autocomplete="off" autocapitalize="characters" spellcheck="false" required /></label>
      <p class="dlg-err" role="alert" hidden></p>
      <div class="confirm-actions">
        <button class="btn btn-ghost" type="button" data-act="cancel">Cancel</button>
        <button class="btn btn-danger" type="submit" disabled>Delete my account</button>
      </div>
    </form>`);
  const form = dlg.querySelector('form'), pw = form.elements.password, word = form.elements.confirm;
  const go = form.querySelector('[type=submit]'), err = form.querySelector('.dlg-err');
  const ready = () => word.value.trim() === 'DELETE' && (!pw || pw.value.length > 0);
  form.addEventListener('input', () => { go.disabled = !ready(); });
  dlg.querySelector('[data-act=cancel]').addEventListener('click', dismiss);
  (pw || word).focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ready() || go.dataset.busy) return;
    go.dataset.busy = '1'; go.disabled = true; go.textContent = 'Deleting…'; err.hidden = true;
    try {
      await deleteMyAccount(pw ? pw.value : null);
      location.replace('/settings?deleted=1');
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      delete go.dataset.busy; go.textContent = 'Delete my account'; go.disabled = !ready();
      if (pw && /password/i.test(ex.message)) { pw.value = ''; go.disabled = true; pw.focus(); }
    }
  });
}

// ---------- preferences: mascot ----------
const seg = $('mascotSeg');
function paint(v) {
  seg.querySelectorAll('[role="radio"]').forEach((b) => {
    const on = b.dataset.v === v;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  $('mascotModes').querySelectorAll('li').forEach((li) => li.classList.toggle('on', li.dataset.v === v));
}
let changedOnce = false;
function showSaved(changed) {
  if (changed) changedOnce = true;
  $('mascotSaved').textContent = changedOnce
    ? (signedIn ? 'Saved to your account.' : 'Saved in this browser.')
    : (signedIn ? 'Kept on your account, so it follows you to other browsers.' : 'Kept in this browser.');
}
function choose(v, focus) {
  paint(v);
  setMascotPref(v);
  showSaved(true);
  if (focus) seg.querySelector(`[data-v="${v}"]`)?.focus();
}
seg.addEventListener('click', (e) => { const b = e.target.closest('[role="radio"]'); if (b) choose(b.dataset.v); });
seg.addEventListener('keydown', (e) => {          // radio-group keys: arrows move and select
  const order = ['on', 'quiet', 'off'];
  const i = order.indexOf(getMascotPref());
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); choose(order[(i + 1) % 3], true); }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); choose(order[(i + 2) % 3], true); }
});
window.addEventListener('sparkscribe:mascot-pref', (e) => paint(e.detail));
paint(getMascotPref());

// ---------- preferences: appearance ----------
const themeSeg = $('themeSeg');
const THEMES = ['system', 'light', 'dark'];
function paintTheme(v) {
  themeSeg.querySelectorAll('[role="radio"]').forEach((b) => {
    const on = b.dataset.v === v;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
}
function chooseTheme(v, focus) {
  paintTheme(v);
  setThemePref(v);
  showSaved(true);
  if (focus) themeSeg.querySelector(`[data-v="${v}"]`)?.focus();
}
themeSeg.addEventListener('click', (e) => { const b = e.target.closest('[role="radio"]'); if (b) chooseTheme(b.dataset.v); });
themeSeg.addEventListener('keydown', (e) => {
  const i = THEMES.indexOf(getThemePref());
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); chooseTheme(THEMES[(i + 1) % 3], true); }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); chooseTheme(THEMES[(i + 2) % 3], true); }
});
paintTheme(getThemePref());

// ---------- privacy: original audio kept on this device (lib/audio-store.js) ----------
const audioSeg = $('audioSeg');
function paintAudio(on) {
  audioSeg.querySelectorAll('[role="radio"]').forEach((b) => { const sel = (b.dataset.v === 'on') === on; b.setAttribute('aria-checked', String(sel)); b.tabIndex = sel ? 0 : -1; });
}
async function showAudioInfo() {
  const i = await audioStorageInfo();
  $('audioInfo').textContent = !i.available ? 'This browser can’t keep audio (private window or storage turned off). Recordings can still be attached to play along.'
    : i.count ? `${i.count} recording${i.count === 1 ? '' : 's'} on this device · ${fmtBytes(i.bytes)}` : 'No recordings kept on this device yet.';
  $('audioClear').disabled = !i.count;
}
audioSeg.addEventListener('click', (e) => {
  const b = e.target.closest('[role="radio"]');
  if (!b) return;
  setKeepAudioPref(b.dataset.v === 'on');
  paintAudio(b.dataset.v === 'on');
  showSaved(true);
});
audioSeg.addEventListener('keydown', (e) => {
  if (!/^Arrow/.test(e.key)) return;
  e.preventDefault();
  const on = !keepAudioPref();
  setKeepAudioPref(on); paintAudio(on); showSaved(true);
  audioSeg.querySelector(`[data-v="${on ? 'on' : 'off'}"]`)?.focus();
});
$('audioClear').addEventListener('click', async () => {
  $('audioClear').disabled = true;
  await clearAllAudio();
  await showAudioInfo();
});
paintAudio(keepAudioPref());
showAudioInfo();

// ---------- start ----------
mountAccountMenu($('accountSlot'), { onChange: (s) => renderAccount(s) });
getSession().then(renderAccount);
mountMascot({ page: 'other' });
