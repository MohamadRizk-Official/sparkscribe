// /auth — sign in, create account, forgot password, and set a new password (after a reset link).
// How the pieces fit (reset sessions, email links, Turnstile): docs/auth/README.md
import { supabase, isConfigured, authSettings, isolatedClient, revokeSessionNow } from '../lib/supabase.js';
import { mountAccountMenu, safeNext, getUser } from '../lib/account.js';
import { createCaptcha, isCaptchaRejection, CAPTCHA_REJECTED } from '../lib/captcha.js';
import { recoveryAge, isFreshRecovery, currentSession, endSession, takeResetLink, peekResetLink, dropResetLink } from '../lib/recovery.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const next = safeNext(params.get('next'), '/');
// `flow=signup` marks the link in a sign-up confirmation email: the callback confirms the address, signs this browser
// out again and sends the person here to sign in (docs/auth/README.md)
const callbackUrl = (to, flow) => `${location.origin}/auth/callback?next=${encodeURIComponent(to)}${flow ? `&flow=${flow}` : ''}`;

const MODES = {
  signin: { title: 'Welcome back', sub: 'Sign in to save transcripts to your library and open them on any device.', submit: 'Sign in' },
  signup: { title: 'Create your account', sub: 'Free. Save transcripts and come back to them any time.', submit: 'Create account' },
  forgot: { title: 'Reset your password', sub: "Enter your email and we'll send you a link to choose a new password.", submit: 'Send reset link' },
  update: { title: 'Choose a new password', sub: 'Pick a new password for your account.', submit: 'Save new password' },
};
let mode = 'signin';
// The form's state: idle -> checking (taken at once, synchronously: a second click finds the form busy) -> verifying
// (waiting a moment for Cloudflare; the button says "Checking…") -> submitting (the request is out; the only state
// with a spinner) -> idle. Every path back ends in setPhase('idle'), so nothing can leave the button busy.
let phase = 'idle';
// A reset link from our email (lib/recovery.js): its token, and once used, the in-memory session it gave
let resetLink = null, resetClient = null, resetToken = null;
// Cloudflare Turnstile (lib/captcha.js): for the modes that call Supabase with an email and password or send an email.
// Created the first time one of them is shown; off (no widget, no token) when the build has no Site Key.
let captcha = null;
const needsCaptcha = (m) => m === 'signin' || m === 'signup' || m === 'forgot';
const CAPTCHA_PENDING = 'Please complete the security check to continue.';

// One-time notes for the sign-in page, set by this site just before it signs a browser out (a link can't produce them):
// after a new password was saved (RESET_DONE), and after an email address was confirmed (VERIFIED, set by callback.js).
const RESET_DONE = 'sparkscribe.resetDone';
const VERIFIED = 'sparkscribe.verified';
function takeNote(key) {
  try {
    const v = JSON.parse(sessionStorage.getItem(key) || 'null');
    sessionStorage.removeItem(key);
    return v && Date.now() - v.at < 600_000 ? v : null;
  } catch { return null; }
}
let googleOn = false, socialMode = true;
const showGoogle = () => $('googleWrap').classList.toggle('hidden', !(googleOn && socialMode));

if (!isConfigured) {
  document.querySelector('.auth-card').classList.add('hidden');
  $('notConfigured').classList.remove('hidden');
} else {
  init();
}

async function init() {
  const requested = params.get('mode');
  let session = await getUser(); // server-verified; clears a stale local session
  // A password-reset session (lib/recovery.js) is only for the "choose a new password" form, and only while the link is
  // fresh. Anywhere else on this page (or once it's old) it is signed out here, so the page works as signed out.
  const local = session ? await currentSession() : null;
  const recovering = session && recoveryAge(local) != null;
  // a reset link opened in this tab (callback.js kept its token here): the form works without any session
  resetLink = requested === 'update' ? peekResetLink() : null;
  if (recovering && !(requested === 'update' && isFreshRecovery(local))) {
    await endSession();
    session = null;
  }
  // no account menu beside the new-password form: the reset isn't a sign-in
  if (!recovering && !resetLink) mountAccountMenu($('accountSlot'));
  // back (or forward) to a page kept in memory after signing out: show it as it is now
  window.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });

  const done = takeNote(RESET_DONE);
  const verified = takeNote(VERIFIED);
  if (params.has('reset') || params.has('verified')) history.replaceState(null, '', `/auth${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`);

  if (!session && (done || verified)) {
    setMode('signin');
    const note = done || verified;
    if (note.email) $('email').value = note.email;
    showMsg(done ? 'Password updated. Sign in with your new password.' : 'Email verified. Sign in to get started.', 'success');
    (note.email ? $('password') : $('email')).focus();
  } else if (requested === 'update' && resetLink) {
    setMode('update');
    $('password').focus();
  } else if (requested === 'update') {
    // Setting a new password needs the reset link from the email: a session that merely exists (a shared
    // computer, a stolen token) can't change the password and lock the owner out.
    if (!session || !isFreshRecovery(local)) {
      setMode('forgot');
      showMsg(session ? 'To set a new password, request a reset link below and open it from your email.' : 'That reset link has expired or was already used. Request a new one below.', 'error');
    } else setMode('update');
  } else if (session) {
    location.replace(next); // already signed in
    return;
  } else {
    setMode(requested === 'signup' ? 'signup' : requested === 'forgot' ? 'forgot' : 'signin');
  }

  // Google appears only when the provider is really on; a disabled button looked like a broken sign-in path
  authSettings().then((s) => { googleOn = !!s?.external?.google; showGoogle(); });

  document.querySelectorAll('#authTabs button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('forgotLink').addEventListener('click', (e) => { e.preventDefault(); setMode('forgot'); });
  $('backToSignin').addEventListener('click', (e) => { e.preventDefault(); setMode('signin'); });
  $('googleBtn').addEventListener('click', google);
  $('authForm').addEventListener('submit', submit);
  // leaving the password form without saving: the reset session ends here
  $('cancelReset').addEventListener('click', async (e) => { e.preventDefault(); dropResetLink(); if (recovering) await endSession(); location.replace('/auth'); });
}

function setMode(m) {
  mode = m;
  const cfg = MODES[m];
  $('authTitle').textContent = cfg.title;
  $('authSub').textContent = cfg.sub;
  $('submitBtn').textContent = cfg.submit;
  document.querySelectorAll('#authTabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  $('authTabs').classList.toggle('hidden', m === 'forgot' || m === 'update');
  const social = m === 'signin' || m === 'signup';
  socialMode = social;
  showGoogle();
  document.querySelector('.auth-or').classList.toggle('hidden', !social);
  $('emailField').classList.toggle('hidden', m === 'update');
  $('passwordField').classList.toggle('hidden', m === 'forgot');
  $('forgotLink').classList.toggle('hidden', m !== 'signin');
  $('confirmField').classList.toggle('hidden', !(m === 'signup' || m === 'update'));
  $('password').autocomplete = m === 'signin' ? 'current-password' : 'new-password';
  $('backToSignin').classList.toggle('hidden', m !== 'forgot');
  $('cancelReset').classList.toggle('hidden', m !== 'update');
  if (needsCaptcha(m) && !captcha) {
    captcha = createCaptcha($('captchaSlot'), { action: 'auth' });
    // the check finished after the person was asked to complete it: that note has done its job
    captcha.onChange((st) => { if (st === 'ready' && $('authMsg').dataset.captcha === '1') hideMsg(); });
  }
  $('captchaSlot').classList.toggle('hidden', !needsCaptcha(m));
  hideMsg();
}

// The Turnstile token for ONE request, following the widget's state (lib/captcha.js):
//   ready        -> the token (never handed out twice)
//   interactive  -> no request: the person is asked to complete the check (no spinner, nothing sent)
//   loading / verifying / expired -> wait a moment (the button says "Checking…"), then decide again
//   error / unavailable -> send without a token: Supabase is the only gate. While its CAPTCHA protection is off people
//                  sign in as usual (nobody is locked out by a widget problem); once it's on, Supabase refuses and the
//                  page says the check didn't go through.
// -> { go: true, token } or { go: false } (the reason is already on screen)
let captchaProblem = null;
async function captchaGate() {
  captchaProblem = null;
  if (!captcha?.enabled) return { go: true, token: undefined };
  let st = captcha.state();
  if (st === 'loading' || st === 'verifying' || st === 'expired') {
    setPhase('verifying');
    st = await captcha.settle(10000);
  }
  if (st === 'ready') return { go: true, token: captcha.take() };
  if (st === 'interactive') { askForCheck(); return { go: false }; }
  if (st === 'error' || st === 'unavailable') {
    captchaProblem = st === 'unavailable'
      ? 'The security check couldn’t load. Check your connection (and any content blocker for challenges.cloudflare.com), then try again.'
      : 'We couldn’t complete the security check. Please try again.';
    captcha.retry(); // a fresh challenge for the next attempt
    return { go: true, token: undefined };
  }
  showMsg('The security check is taking longer than usual. Please try again in a moment.', 'error');
  return { go: false };
}
function askForCheck() {
  showMsg(CAPTCHA_PENDING, 'error');
  $('authMsg').dataset.captcha = '1';
  const slot = $('captchaSlot');
  slot.scrollIntoView({ block: 'center', behavior: 'smooth' });
  slot.classList.remove('attention'); void slot.offsetWidth; slot.classList.add('attention');
}

// One line of feedback under the form. kinds: note, error, success, styled by is-<kind> (namespaced: a bare "error"
// class picked up the site's error-panel margin). Errors are announced at once (role=alert), the rest politely.
function showMsg(text, kind = 'note', resendTo = null) {
  const el = $('authMsg');
  const line = document.createElement('span');
  line.className = 'auth-msg-text';
  line.textContent = text;
  el.replaceChildren(line);
  el.className = `auth-msg is-${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  delete el.dataset.captcha;
  if (resendTo) {
    // the confirmation email didn't arrive (spam, slow, or the link expired): ask for a fresh one
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'auth-resend';
    b.textContent = 'Send the link again';
    b.addEventListener('click', () => resend(resendTo, b));
    line.append(' ', b);
  }
}
async function resend(email, btn) {
  if (phase !== 'idle') return;
  phase = 'checking';
  btn.disabled = true;
  const gate = await captchaGate();
  if (!gate.go) { setPhase('idle'); btn.disabled = false; return; }
  setPhase('submitting');
  const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: callbackUrl(next, 'signup'), captchaToken: gate.token } });
  setPhase('idle');
  captcha?.reset();
  if (error) { btn.disabled = false; return showMsg(explain(error), 'error'); }
  showMsg(`Sent again to ${email}. It can take a few minutes; check spam too.`, 'success');
}
function hideMsg() { $('authMsg').className = 'auth-msg hidden'; }

function setPhase(p) {
  phase = p;
  const btn = $('submitBtn');
  btn.disabled = p !== 'idle';
  btn.classList.toggle('loading', p === 'submitting');
  btn.setAttribute('aria-busy', String(p !== 'idle'));
  btn.textContent = p === 'verifying' ? 'Checking…' : MODES[mode].submit;
}

// Supabase errors in our own words. Anything unrecognised gets a general message: server text never reaches the page.
function explain(error) {
  const msg = error?.message || String(error);
  const code = error?.code || '';
  if (isCaptchaRejection(error)) return captchaProblem || CAPTCHA_REJECTED;
  if (code === 'same_password' || /different from the old password/i.test(msg)) return 'Choose a password that’s different from your current one.';
  if (code === 'weak_password' || /weak|pwned|leaked/i.test(msg)) return 'Choose a stronger password: this one is too easy to guess or has appeared in a data breach.';
  if (error?.name === 'AuthSessionMissingError' || /session missing|session_not_found|refresh token/i.test(msg)) return 'Your reset link has expired. Request a new one below.';
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return 'Incorrect email or password.';
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) return 'Please confirm your email first. Check your inbox (and spam) for the link we sent.';
  // the email service refused or failed: not the person's fault, and retrying right away rarely helps
  if (/not authori[sz]ed|error sending|sending (confirmation|recovery|magic link)|smtp/i.test(msg)) return "We couldn't send the email just now. Please try again in a few minutes; if it keeps happening, contact support.";
  if (code === 'user_already_exists' || /already registered|already exists/i.test(msg)) return 'An account with this email already exists. Try signing in.';
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || /rate limit|too many|security purposes/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.';
  if (code === 'signup_disabled') return 'New accounts can’t be created right now.';
  return 'Something went wrong. Please try again.';
}

async function submit(e) {
  e.preventDefault();
  if (phase !== 'idle') return; // one request at a time (a double click sends nothing twice)
  phase = 'checking';
  hideMsg();
  const email = $('email').value.trim();
  const password = $('password').value;
  const confirm = $('confirm').value;

  const invalid = (text) => { setPhase('idle'); showMsg(text, 'error'); };
  if (mode !== 'update' && !/^\S+@\S+\.\S+$/.test(email)) return invalid('Enter a valid email address.');
  if ((mode === 'signin' || mode === 'signup' || mode === 'update') && password.length < 8) return invalid('Passwords need at least 8 characters.');
  if ((mode === 'signup' || mode === 'update') && password !== confirm) return invalid("The two passwords don't match.");

  // sign-in, sign-up and the reset email carry a fresh Turnstile token (once Supabase's CAPTCHA protection is on, it insists)
  let token;
  if (needsCaptcha(mode)) {
    const gate = await captchaGate();
    if (!gate.go) return setPhase('idle');
    token = gate.token;
  }
  const sentWith = mode;
  setPhase('submitting');
  try {
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken: token } });
      if (error) throw error;
      location.replace(next);
      return;
    } else if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: callbackUrl(next, 'signup'), captchaToken: token } });
      if (error) throw error;
      if (data.session) return location.replace(next); // email confirmation is off
      // With confirmation on, Supabase deliberately gives the same answer for new and existing emails.
      showMsg(`Check ${email} for a link to verify your email address, then sign in.`, 'success', email);
      $('authForm').reset();
    } else if (mode === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl('/auth?mode=update'), captchaToken: token });
      if (error) throw error;
      showMsg(`If an account exists for ${email}, a reset link is on its way. Check your inbox and spam.`, 'success');
    } else if (mode === 'update' && resetLink) {
      await saveWithResetLink(password);
    } else if (mode === 'update') {
      // a reset session from an older email link (Supabase's own ?code= link): only while it is fresh
      const live = await currentSession();
      if (!live || !isFreshRecovery(live)) {
        await endSession();
        setMode('forgot');
        return showMsg('Your reset link has expired. Request a new one below.', 'error');
      }
      const owner = live.user?.email || '';
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        if (/session missing|session_not_found/i.test(error.message || '') || error.name === 'AuthSessionMissingError') { await endSession(); setMode('forgot'); }
        throw error;
      }
      await passwordSaved(owner, () => endSession({ everywhere: true }));
    }
  } catch (err) {
    const unconfirmed = mode === 'signin' && (err?.code === 'email_not_confirmed' || /email not confirmed/i.test(err?.message || ''));
    showMsg(explain(err), 'error', unconfirmed ? email : null);
  } finally {
    if (phase === 'submitting') setPhase('idle');
    if (needsCaptcha(sentWith)) captcha?.reset(); // that token is used: the next attempt gets a new one
  }
}

// A reset link from our email: its token is used only now, together with the new password, in a separate in-memory
// session. Nothing is stored in this browser and nobody is signed in here, so the link can never open the app; the
// account is then signed out everywhere and the person signs in with the new password.
async function saveWithResetLink(password) {
  if (!resetClient) {
    const link = takeResetLink(); // used once: a refresh after this can't try it again
    const iso = link && isolatedClient();
    const { data: verified, error } = link ? await iso.auth.verifyOtp({ token_hash: link.hash, type: 'recovery' }) : { error: true };
    if (error) {
      resetLink = null;
      setMode('forgot');
      showMsg('That reset link has expired or was already used. Request a new one below.', 'error');
      return;
    }
    resetClient = iso; // a refused password (too weak, same as before) can be fixed without a new link
    resetToken = verified?.session?.access_token || null;
    // leaving the page before the password is saved ends that session on the server too (nothing is left behind)
    window.addEventListener('pagehide', endResetClient, { once: true });
  }
  const { data, error } = await resetClient.auth.updateUser({ password });
  if (error) throw error;
  const owner = data?.user?.email || '';
  await passwordSaved(owner, async () => {
    window.removeEventListener('pagehide', endResetClient);
    const c = resetClient, t = resetToken;
    resetClient = null; resetToken = null;
    const { error: out } = await c.auth.signOut({ scope: 'global' }).catch((e) => ({ error: e }));
    if (out) revokeSessionNow(t); // the global sign-out failed: at least this session ends
    resetLink = null;
    if (await currentSession()) await endSession(); // whoever else was signed in here: the sign-in page comes next
  });
}

function endResetClient() {
  if (!resetClient) return;
  resetClient = null;
  revokeSessionNow(resetToken); // synchronous keepalive request: it goes out even as the page closes
  resetToken = null;
}

// Saved: end the session(s), then the sign-in page says so (history replaced: Back can't return to a signed-in page)
async function passwordSaved(email, endSessions) {
  try { sessionStorage.setItem(RESET_DONE, JSON.stringify({ at: Date.now(), email })); } catch {}
  await endSessions();
  $('authForm').reset();
  phase = 'leaving';
  location.replace('/auth?reset=done');
}

async function google() {
  hideMsg();
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callbackUrl(next) } });
  if (error) showMsg(explain(error), 'error');
}
