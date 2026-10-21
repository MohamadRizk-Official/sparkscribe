// Session helpers + the small account area in the top bar (shared by every page).
import { supabase, isConfigured } from './supabase.js';
import { adoptAccountPrefs } from './prefs.js';
import { getBillingStatus, usageText, deleteAccountOnServer } from './billing.js';
import { mountThemeToggle } from './theme-toggle.js';
import { clearAllAudio, deleteAudio, PENDING_AUDIO_KEY } from './audio-store.js';
import { guardRecovery, currentSession } from './recovery.js';
import { mountAmbient, mountHeaderState, mountNavIndicator } from '../electric/chrome.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only ever redirect to a path on this site. Browsers drop tabs and newlines while parsing a URL, so "/\t/evil.com"
// would become "//evil.com": reject control characters and backslashes, then let the URL parser decide the origin.
export function safeNext(value, fallback = '/') {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  try {
    const u = new URL(value, location.origin);
    return u.origin === location.origin ? u.pathname + u.search + u.hash : fallback;
  } catch { return fallback; }
}

export const currentPath = () => location.pathname + location.search;

// The 13+ / Terms confirmation every account gives once. An email sign-up records it at sign-up; an account first
// created through Google (from the sign-in tab, or before this existed) is asked on its first visit, on any page,
// before using the app. Stored in the account's user metadata (the person's own confirmation, with its time).
export const hasConsent = (user) => !!(user?.user_metadata?.terms_accepted_at && user?.user_metadata?.age_13_plus_confirmed_at);
export async function recordConsent() {
  const at = new Date().toISOString();
  const { data, error } = await supabase.auth.updateUser({ data: { age_13_plus_confirmed_at: at, terms_accepted_at: at } });
  if (error) throw error;
  return data.user;
}
// pages a person may open before confirming (to read what they're agreeing to, or to confirm it)
const CONSENT_FREE = /^\/(auth|terms|privacy)(\/|$)/;
export function consentUrl(next = currentPath()) { return `/auth?mode=consent&next=${encodeURIComponent(next)}`; }

// Fast, local check (reads the stored session). Good for UI state.
export async function getSession() {
  if (!isConfigured) return null;
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

// Verified with the auth server. Use before showing private pages.
// A stored session the server rejects (expired, revoked, user deleted) is cleared from this browser,
// otherwise the sign-in page would think you're signed in and bounce you back in a loop.
export async function getUser() {
  if (!isConfigured) return null;
  const { data, error } = await supabase.auth.getUser();
  if (!error && data.user) return data.user;
  const { data: local } = await supabase.auth.getSession();
  if (local.session) await supabase.auth.signOut({ scope: 'local' });
  return null;
}

// Private pages: send signed-out visitors to sign in, then back here (and accounts without the confirmation to give it).
export async function requireUser() {
  const user = await getUser();
  if (!user) {
    location.replace(`/auth?next=${encodeURIComponent(currentPath())}`);
    return new Promise(() => {}); // stop the page while navigating
  }
  // a password-reset session isn't a way into the app (lib/recovery.js)
  if (await guardRecovery(await currentSession())) return new Promise(() => {});
  if (!hasConsent(user) && !CONSENT_FREE.test(location.pathname)) {
    location.replace(consentUrl());
    return new Promise(() => {});
  }
  return user;
}

export async function signOut() {
  if (!isConfigured) return;
  try {
    localStorage.removeItem('sparkscribe.pendingSave'); // an unsaved transcript parked for sign-in (lib/transcripts.js)
    for (const k of Object.keys(localStorage)) if (k.startsWith('sparkscribe.across.')) localStorage.removeItem(k); // answers across recordings that older versions kept in this browser (now saved to the account)
  } catch {}
  deleteAudio(PENDING_AUDIO_KEY); // ...and its audio
  await supabase.auth.signOut();
}

// Things this browser keeps for the signed-in person: an unsaved transcript waiting to be saved, preferences,
// AI consent, checklist ticks. Device-level settings (theme, the downloaded speech models) stay.
const KEEP_ON_DEVICE = new Set(['sparkscribe.theme', 'sparkscribe.modelsCached']);
export function forgetThisBrowser() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('sparkscribe') && !KEEP_ON_DEVICE.has(k)) localStorage.removeItem(k);
    for (const k of Object.keys(sessionStorage)) if (k.startsWith('sparkscribe')) sessionStorage.removeItem(k);
  } catch {}
  clearAllAudio(); // original recordings kept on this device for playback (lib/audio-store.js)
}

// Permanently delete the signed-in account. The password (null for accounts without one) is checked by signing in again (the database refuses
// unless the latest sign-in is under 10 minutes old), then one database call removes the account and everything in
// it, all or nothing. Throws an Error with a message to show; nothing is deleted when it throws.
export async function deleteMyAccount(password, captchaToken) {
  if (!isConfigured) throw new Error('Accounts aren’t available here.');
  const { data: { session } } = await supabase.auth.getSession();
  const email = session?.user?.email;
  if (!email) throw new Error('Sign in again to delete your account.');
  if (password != null) {
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
    if (authError) {
      if (authError.code === 'captcha_failed' || /captcha/i.test(authError.message)) throw new Error('The security check didn’t go through, so nothing was deleted. Please try again.');
      throw new Error(/invalid login|invalid_grant|credentials/i.test(authError.message) ? 'That password isn’t right.' : authError.message);
    }
  }
  // through the server: it cancels any Stripe subscription first, so nobody keeps paying for a deleted account
  let data;
  try {
    data = await deleteAccountOnServer();
  } catch (err) {
    throw new Error(err.code === 'network' || err.code === 'deletion_unavailable' || err.code === 'deletion_failed' ? err.message : 'Your account couldn’t be deleted, and nothing was removed. Try again.');
  }
  if (!data?.deleted) {
    throw new Error(data?.reason === 'subscription'
      ? 'You have a paid plan that is still active. Cancel it first, then delete your account.'
      : password != null ? 'Please enter your password again.' : 'For your security, sign out and sign in again, then delete your account within 10 minutes.');
  }
  forgetThisBrowser();
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {}); // the account is gone; just drop this browser's session
}

async function loadProfile(user) {
  const { data } = await supabase.from('profiles').select('display_name, avatar_url').eq('id', user.id).maybeSingle();
  const meta = user.user_metadata || {};
  return {
    name: data?.display_name || meta.full_name || meta.name || '',
    avatar: data?.avatar_url || meta.avatar_url || '',
    email: user.email || '',
  };
}

const GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>';

function initialsOf(nameOrEmail) {
  const parts = String(nameOrEmail || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

// Renders "Sign in" or the avatar menu into `slot`, and keeps it in sync with auth changes.
export function mountAccountMenu(slot, { onChange } = {}) {
  mountAmbient(); // the lit canvas + circuit (electric/chrome.js), on every page
  mountHeaderState();
  mountThemeToggle(slot); // the Light / Dark switch sits in every header, signed in or not
  if (!slot || !isConfigured) return;
  slot.classList.add('account');
  slot.innerHTML = '<span class="acct-skel" aria-hidden="true"></span>';

  let menu = null;
  const close = () => { menu?.remove(); menu = null; document.removeEventListener('pointerdown', outside); slot.querySelector('.acct-btn')?.setAttribute('aria-expanded', 'false'); };
  const outside = (e) => { if (menu && !menu.contains(e.target) && !slot.contains(e.target)) close(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  // The site navigation, one source for every page: placed right after the logo. Signed out: Features, How it works,
  // Pricing. Signed in: Home, Library, Courses (the Library's course view), Pricing. On narrow screens the links fold
  // into a Menu button. One electric line marks the current page (electric/chrome.js).
  function currentKey() {
    const path = location.pathname.replace(/\/$/, '') || '/';
    const q = new URLSearchParams(location.search);
    if (path === '/library') return q.get('view') === 'folders' || q.get('folder') ? 'courses' : 'library';
    return { '/': 'home', '/pricing': 'pricing', '/account': 'pricing' }[path] || '';
  }
  function siteNav(signedIn) {
    const bar = slot.closest('.topbar');
    if (!bar) return;
    let nav = bar.querySelector(':scope > .site-nav');
    if (!nav) {
      nav = document.createElement('nav');
      nav.className = 'site-nav';
      nav.setAttribute('aria-label', 'Main');
      const brand = bar.querySelector(':scope > .brand');
      brand ? brand.after(nav) : bar.prepend(nav);
    }
    const links = signedIn
      ? [['/', 'Home', 'home'], ['/library', 'Library', 'library'], ['/library?view=folders', 'Courses', 'courses'], ['/pricing', 'Pricing', 'pricing']]
      : [['/#features', 'Features', ''], ['/#how', 'How it works', ''], ['/pricing', 'Pricing', 'pricing']];
    const here = currentKey();
    const item = ([href, label, key]) => `<a class="nav-link" href="${href}" data-nav="${key}"${key && key === here ? ' aria-current="page"' : ''}>${label}</a>`;
    nav.innerHTML = `<button type="button" class="nav-toggle" aria-expanded="false" aria-controls="siteNavLinks"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg><span>Menu</span></button>
      <div class="nav-links" id="siteNavLinks">${links.map(item).join('')}${signedIn ? '' : `<a class="nav-link nav-only-sm" href="/auth?next=${encodeURIComponent(currentPath())}">Sign in</a><a class="nav-link nav-only-sm" href="/settings">Settings</a>`}</div>`;
    const toggle = nav.querySelector('.nav-toggle');
    const closeNav = () => { nav.classList.remove('open'); nav.querySelector('.nav-toggle')?.setAttribute('aria-expanded', 'false'); };
    if (!nav.dataset.bound) { // once per page, however often the menu re-renders
      nav.dataset.bound = '1';
      document.addEventListener('pointerdown', (e) => { if (!nav.contains(e.target)) closeNav(); });
      nav.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeNav(); nav.querySelector('.nav-toggle')?.focus(); } });
      // the Library switches between its views without reloading: keep "Library" / "Courses" in step
      const sync = () => {
        const k = currentKey();
        nav.querySelectorAll('.nav-link[data-nav]').forEach((l) => (l.dataset.nav && l.dataset.nav === k ? l.setAttribute('aria-current', 'page') : l.removeAttribute('aria-current')));
        nav.querySelector('.nav-links')?.dispatchEvent(new Event('pointerleave'));
      };
      addEventListener('popstate', sync);
      addEventListener('sparkscribe:route', sync);
    }
    toggle.addEventListener('click', () => {
      const open = !nav.classList.contains('open');
      nav.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      if (open) nav.querySelector('.nav-link')?.focus();
    });
    nav.querySelectorAll('.nav-link').forEach((l) => l.addEventListener('click', closeNav));
    mountNavIndicator(nav);
    newRecordingButton(signedIn);
  }

  // The header's one primary action for a signed-in student: start a new recording. On the home page it opens the
  // file picker right away; elsewhere it goes home to the upload area.
  function newRecordingButton(signedIn) {
    const right = slot.parentElement;
    let btn = right?.querySelector(':scope > .hdr-new');
    if (!signedIn || !right) { btn?.remove(); return; }
    if (btn) return;
    btn = document.createElement('a');
    btn.className = 'btn btn-primary hdr-new';
    btn.href = '/#upload';
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>New recording</span>';
    btn.addEventListener('click', (e) => {
      const input = document.getElementById('fileInput');
      if (!input || location.pathname !== '/') return;
      e.preventDefault();
      input.click();
    });
    right.prepend(btn);
  }

  async function render(session) {
    close();
    if (!session) {
      const onAuthPage = location.pathname.startsWith('/auth');
      const back = encodeURIComponent(currentPath());
      slot.innerHTML = onAuthPage ? '' : `<a class="acct-signin" href="/auth?next=${back}">Sign in</a><a class="btn btn-primary acct-start" href="/auth?mode=signup&amp;next=${back}">Get started</a>`;
      siteNav(false);
      return;
    }
    siteNav(true);
    if (await guardRecovery(session)) return; // a password-reset session: back to the password form, or signed out
    // a signed-in account that hasn't confirmed 13+ and the Terms (first Google sign-in) does that before anything else
    if (!hasConsent(session.user) && !CONSENT_FREE.test(location.pathname)) { location.replace(consentUrl()); return; }
    adoptAccountPrefs(session.user);
    const p = await loadProfile(session.user);
    const label = p.name || p.email;
    slot.innerHTML = `<button class="acct-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Account menu">
      ${p.avatar ? `<img src="${esc(p.avatar)}" alt="" referrerpolicy="no-referrer" />` : `<span>${esc(initialsOf(label))}</span>`}
    </button>`;
    const btn = slot.querySelector('.acct-btn');
    btn.addEventListener('click', () => {
      if (menu) return close();
      btn.setAttribute('aria-expanded', 'true');
      menu = document.createElement('div');
      menu.className = 'acct-menu';
      menu.setAttribute('role', 'menu');
      menu.innerHTML = `
        <div class="acct-head"><span class="acct-avatar" aria-hidden="true">${p.avatar ? `<img src="${esc(p.avatar)}" alt="" referrerpolicy="no-referrer" />` : esc(initialsOf(label))}</span><span class="acct-who">${p.name ? `<b>${esc(p.name)}</b>` : ''}<span>${esc(p.email)}</span></span></div>
        <a role="menuitem" href="/account"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3 5 14h6l-1 7 8-11h-6z"/></svg><span class="acct-plan-item">Plan &amp; billing<small data-usage></small></span></a>
        <a role="menuitem" href="/settings">${GEAR}Settings</a>
        <a role="menuitem" href="/help"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.3M12 17h.01"/></svg>Help</a>
        <hr />
        <button role="menuitem" type="button" data-signout><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 12H4m0 0 4-4m-4 4 4 4M13 5h6v14h-6"/></svg>Sign out</button>`;
      menu.querySelector('[data-signout]').addEventListener('click', async () => {
        await signOut();
        if (/^\/(library|transcript|account)/.test(location.pathname)) location.replace('/');
      });
      // plan + this period's usage, fetched when the menu opens (display only)
      getBillingStatus().then((b) => {
        const el = menu?.querySelector('[data-usage]');
        if (el) el.textContent = `${b.planName} · ${usageText(Number(b.usedSeconds), b.monthlySeconds)}`;
      }, () => {});
      slot.appendChild(menu);
      menu.querySelector('[role="menuitem"]')?.focus();
      // arrow keys move between items (a real menu, not a tooltip)
      menu.addEventListener('keydown', (e) => {
        const items = [...menu.querySelectorAll('[role="menuitem"]')];
        const i = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
        if (e.key === 'Escape') { close(); btn.focus(); }
      });
      setTimeout(() => document.addEventListener('pointerdown', outside), 0);
    });
  }

  getSession().then((s) => { render(s); onChange?.(s); });
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION') return; // handled by getSession above
    // defer: never await Supabase calls inside this callback (it can deadlock the client)
    setTimeout(() => { render(session); onChange?.(session); }, 0);
  });
}
