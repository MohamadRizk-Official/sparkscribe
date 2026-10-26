// Settings: Account (who you're signed in as), Plan & billing (a summary; changes happen on /account),
// Preferences (appearance, the mascot), Privacy (how your data is handled).
// Works signed out too: preferences are kept in this browser, and on the account when signed in.
import { mountAccountMenu, getSession, signOut, esc, deleteMyAccount, changeEmail } from '../lib/account.js';
import { makeDialog } from '../library/dialogs.js';
import { createCaptcha } from '../lib/captcha.js';
import { getMascotPref, setMascotPref, getThemePref } from '../lib/prefs.js';
import { switchTheme } from '../lib/theme-toggle.js';
import { mountMascot } from '../mascot/mascot.js';
import { getBillingStatus, usageParts, usageLevel, dateText } from '../lib/billing.js';
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
    $('dangerSlot').innerHTML = '';
    showSaved();
    renderBilling(null);
    return;
  }
  renderBilling(session);
  const u = session.user, meta = u.user_metadata || {};
  const name = meta.full_name || meta.name || '';
  body.innerHTML = `<div class="set-acct-row"><div class="set-who"><b>${esc(name || u.email || 'Signed in')}</b>${name ? `<span>${esc(u.email || '')}</span>` : ''}</div>
    <div class="set-actions">${u.email ? '<button class="btn btn-ghost" type="button" id="changeEmailBtn">Change email</button>' : ''}<button class="btn btn-ghost" type="button" id="signOutBtn">Sign out</button></div></div>
    ${u.new_email ? `<p class="set-pending" role="status">Waiting for you to confirm <b>${esc(u.new_email)}</b>. Open the link we emailed to change your sign-in email.</p>` : ''}`;
  $('signOutBtn').addEventListener('click', async () => { await signOut(); location.reload(); });
  $('changeEmailBtn')?.addEventListener('click', () => openEmailDialog(u));
  // deleting the account is the last thing on the page (end of Privacy & data), quiet, never next to everyday actions
  $('dangerSlot').innerHTML = DELETION_ON ? `<div class="set-row set-danger"><div class="set-row-text"><h3>Delete account</h3><p>Permanently delete your account and everything saved in it.</p></div>
      <button class="btn btn-ghost btn-sm set-danger-btn" type="button" id="deleteAccountBtn">Delete account…</button></div>` : '';
  $('deleteAccountBtn')?.addEventListener('click', () => openDeleteDialog(u));
  showSaved();
}

// ---------- change email: Supabase sends the confirmation link(s); nothing changes until a link is opened ----------
// The link lands on /auth/callback (type=email_change), which confirms it without signing anyone in. With Supabase's
// secure email change, the current address gets a link too and both must be opened (the callback says so).
function openEmailDialog(user) {
  const google = !(user.app_metadata?.providers || [user.app_metadata?.provider]).includes('email');
  const { dlg, dismiss } = makeDialog('email-dlg', `
    <form class="dlg-form" novalidate>
      <h3>Change your email</h3>
      <div class="dlg-body"><p>We’ll send a confirmation link to the new address. Your email stays <b>${esc(user.email)}</b> until you open it.</p>
        ${google ? '<p class="dlg-dim">You sign in with Google, and that keeps working after the change.</p>' : ''}</div>
      <label class="dlg-field"><span>New email address</span><input type="email" name="email" autocomplete="email" inputmode="email" maxlength="254" required /></label>
      <p class="dlg-err" role="alert" hidden></p>
      <div class="confirm-actions">
        <button class="btn btn-ghost" type="button" data-act="cancel">Cancel</button>
        <button class="btn btn-primary" type="submit">Send confirmation link</button>
      </div>
    </form>`);
  const form = dlg.querySelector('form'), input = form.elements.email, go = form.querySelector('[type=submit]'), err = form.querySelector('.dlg-err');
  dlg.querySelector('[data-act=cancel]').addEventListener('click', dismiss);
  input.focus();
  const say = (m) => { err.textContent = m; err.hidden = false; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (go.dataset.busy) return;
    const email = input.value.trim().toLowerCase();
    err.hidden = true;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return say('Enter a valid email address.');
    if (email === String(user.email || '').toLowerCase()) return say('That’s already your email address.');
    go.dataset.busy = '1'; go.disabled = true; go.textContent = 'Sending…';
    const { error } = await changeEmail(email);
    delete go.dataset.busy; go.disabled = false; go.textContent = 'Send confirmation link';
    if (error) {
      const code = error.code || '';
      if (code === 'email_exists' || /already (been )?registered|already exists/i.test(error.message)) return say('That email address is already used by another SparkScribe account.');
      if (code === 'over_email_send_rate_limit' || error.status === 429) return say('Too many emails were sent just now. Try again in a few minutes.');
      if (code === 'email_address_invalid' || code === 'validation_failed') return say('That email address can’t be used. Check it and try again.');
      return say('The confirmation email couldn’t be sent. Try again in a moment.');
    }
    form.innerHTML = `<h3>Check your inbox</h3>
      <div class="dlg-body"><p>We sent a confirmation link to <b>${esc(email)}</b>. Open it to finish. Until then you keep signing in with <b>${esc(user.email)}</b>.</p>
        <p class="dlg-dim">For your security, a link may also arrive at your current address. If it does, open that one too. Nothing there? Check spam, or try again in a few minutes.</p></div>
      <div class="confirm-actions"><button class="btn btn-primary" type="button" data-act="done">Done</button></div>`;
    form.querySelector('[data-act=done]').addEventListener('click', dismiss);
    form.querySelector('[data-act=done]').focus();
    getSession().then(renderAccount); // shows "Waiting for you to confirm …"
  });
}

// ---------- plan & billing: what the server says (display only; every check happens on the server) ----------
let billingFor;
async function renderBilling(session) {
  const body = $('billingBody');
  const who = session?.user?.id || null;
  if (billingFor === who && body.dataset.done) return;
  billingFor = who;
  if (!session) {
    body.innerHTML = `<div class="set-row-text"><h3>Free to start</h3><p>Sign in to see your plan and this month’s transcription time.</p></div>
      <a class="btn btn-ghost" href="/pricing">See plans</a>`;
    body.dataset.done = '1';
    return;
  }
  let s;
  try { s = await getBillingStatus(); } catch {
    body.innerHTML = '<p class="set-note">Your plan couldn’t be loaded just now. <a href="/account">Open Plan &amp; billing</a></p>';
    return;
  }
  if (billingFor !== who) return;
  const u = usageParts(Number(s.usedSeconds) || 0, s.monthlySeconds);
  const pct = s.monthlySeconds ? Math.min(100, Math.round(((Number(s.usedSeconds) || 0) / s.monthlySeconds) * 100)) : 0;
  const subEnd = s.renewsAt || s.periodEnd;
  const when = !s.periodEnd ? '' : s.cancelAtPeriodEnd ? `Ends ${dateText(subEnd)}, then Free.` : s.plan === 'free' ? `Resets ${dateText(s.periodEnd)}.`
    : s.billingInterval === 'year' ? `Billed yearly, renews ${dateText(subEnd)}. Time renews ${dateText(s.periodEnd)}.` : `Renews ${dateText(s.periodEnd)}.`;
  body.innerHTML = `<div class="set-plan"><div class="set-row-text"><h3>${esc(s.planName || 'Free')}</h3>${when ? `<p>${esc(when)}</p>` : ''}</div>
      <div class="set-usage"><div class="set-usage-top"><span>Transcription this period</span><b>${esc(`${u.used} / ${u.total} ${u.unit}`)}</b></div>
        <div class="set-meter lvl-${esc(usageLevel(Number(s.usedSeconds) || 0, s.monthlySeconds))}" role="progressbar" aria-label="Transcription time used" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div></div></div>
    ${s.paymentProblem ? '<p class="set-warn" role="status">There’s a problem with your last payment. Update your card in Plan &amp; billing to keep your plan.</p>' : ''}
    <div class="set-actions"><a class="btn btn-primary" href="/account">${s.plan === 'free' ? 'Upgrade' : 'Manage plan &amp; billing'}</a><a class="btn btn-ghost" href="/pricing">Compare plans</a></div>`;
  body.dataset.done = '1';
}

// ---------- section navigation: the link for the section in view is marked current ----------
function trackSections() {
  const links = [...document.querySelectorAll('.set-nav a')];
  const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
  const nav = document.querySelector('.set-nav');
  const mark = (id) => {
    links.forEach((a) => { if (a === byId.get(id)) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
    // on phones the list scrolls sideways: keep the current one in view (horizontally only)
    const a = byId.get(id);
    if (a && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2, behavior: 'smooth' });
  };
  const visible = new Map();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
    const top = [...byId.keys()].find((id) => visible.get(id) > 0);
    if (top) mark(top);
  }, { rootMargin: '-15% 0px -55% 0px', threshold: [0, 0.01] });
  byId.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
  links.forEach((a) => a.addEventListener('click', () => mark(a.getAttribute('href').slice(1))));
  const first = location.hash.slice(1);
  mark(byId.has(first) ? first : 'account');
}
trackSections();

// ---------- delete account ----------
// What goes, said plainly; the password and the typed word guard against a slip or someone else at this computer.
// Shown only once the database function exists (supabase/proposed/*_account_deletion.sql): set VITE_ACCOUNT_DELETION=1
// in the same release that applies the migration.
const DELETION_ON = import.meta.env.VITE_ACCOUNT_DELETION === '1';
const justDeleted = new URLSearchParams(location.search).has('deleted');
if (justDeleted) history.replaceState(null, '', '/settings');
function openDeleteDialog(user) {
  const hasPassword = (user.app_metadata?.providers || [user.app_metadata?.provider]).includes('email');
  let captcha = null; // created below, removed when the dialog closes (however it closes)
  const { dlg, dismiss } = makeDialog('delete-account-dlg', `
    <form class="dlg-form" novalidate>
      <h3>Delete your account?</h3>
      <div class="dlg-body">
        <p>This permanently deletes:</p>
        <ul class="dlg-list"><li>every saved transcript and its speaker names</li><li>summaries, notes, insights and Ask answers</li><li>everything made in Create (study guides, quizzes, recaps…)</li><li>your folders and preferences</li><li>your sign-in${user.email ? ` (${esc(user.email)})` : ''}</li></ul>
        <p class="dlg-dim">A paid plan is canceled right away, so you won’t be charged again. It can’t be undone, and we can’t restore it. Your audio was never uploaded. Files you exported stay on your devices.</p>
      </div>
      ${hasPassword ? '<label class="dlg-field"><span>Your password</span><input type="password" name="password" autocomplete="current-password" required /></label><div data-captcha></div>' : ''}
      <label class="dlg-field"><span>Type DELETE to confirm</span><input type="text" name="confirm" autocomplete="off" autocapitalize="characters" spellcheck="false" required /></label>
      <p class="dlg-err" role="alert" hidden></p>
      <div class="confirm-actions">
        <button class="btn btn-ghost" type="button" data-act="cancel">Cancel</button>
        <button class="btn btn-danger" type="submit" disabled>Delete my account</button>
      </div>
    </form>`, () => captcha?.remove());
  const form = dlg.querySelector('form'), pw = form.elements.password, word = form.elements.confirm;
  // checking the password signs in again, which Supabase protects with the same CAPTCHA as the sign-in page
  if (pw) captcha = createCaptcha(form.querySelector('[data-captcha]'), { action: 'reauth' });
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
      // no token (the check couldn't run)? still ask: Supabase decides, and says so if it requires one
      let token, problem = null;
      if (captcha?.enabled) {
        let st = captcha.state();
        if (st === 'loading' || st === 'verifying' || st === 'expired') st = await captcha.settle(10000);
        if (st === 'interactive') throw new Error('Please complete the security check to continue.');
        if (st === 'ready') token = captcha.take(); // never handed out twice
        else problem = st === 'unavailable'
          ? 'The security check couldn’t load. Check your connection (and any content blocker for challenges.cloudflare.com), then try again.'
          : 'We couldn’t complete the security check. Please try again.';
      }
      try { await deleteMyAccount(pw ? pw.value : null, token); } catch (de) {
        throw (problem && /security check/i.test(de.message) ? new Error(problem) : de);
      } finally { captcha?.reset(); }
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
  switchTheme(themeSeg.querySelector(`[data-v="${v}"]`), v); // the new appearance grows out of the button you chose
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
