// /auth — sign in, create account, forgot password, and set a new password (after a reset link).
import { supabase, isConfigured, authSettings } from '../lib/supabase.js';
import { mountAccountMenu, safeNext, getUser, hasConsent, recordConsent, signOut } from '../lib/account.js';
import { createCaptcha, CaptchaError, isCaptchaRejection, CAPTCHA_REJECTED } from '../lib/captcha.js';
import { recoveryAge, isFreshRecovery, currentSession, endSession } from '../lib/recovery.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const next = safeNext(params.get('next'), '/');
const callbackUrl = (to) => `${location.origin}/auth/callback?next=${encodeURIComponent(to)}`;

const MODES = {
  signin: { title: 'Welcome back', sub: 'Sign in to save transcripts to your library and open them on any device.', submit: 'Sign in' },
  signup: { title: 'Create your account', sub: 'Free. Save transcripts and come back to them any time.', submit: 'Create account' },
  forgot: { title: 'Reset your password', sub: "Enter your email and we'll send you a link to choose a new password.", submit: 'Send reset link' },
  update: { title: 'Choose a new password', sub: 'Pick a new password for your account.', submit: 'Save new password' },
  // a signed-in account that hasn't confirmed yet (first sign-in with Google)
  consent: { title: 'One more step', sub: 'Before you start, please confirm your age and that you agree to the Terms.', submit: 'Continue' },
};
const PENDING_CONSENT = 'sparkscribe.consentAt'; // ticked on the sign-up tab before going to Google (this browser only)
let mode = 'signin';
let googleOn = false, socialMode = true;
// Cloudflare Turnstile (lib/captcha.js): for the modes that call Supabase with an email and password or send an email.
// Created the first time one of them is shown; off (no widget, no token) when the build has no Site Key.
let captcha = null;
const needsCaptcha = (m) => m === 'signin' || m === 'signup' || m === 'forgot';
const showGoogle = () => $('googleWrap').classList.toggle('hidden', !(googleOn && socialMode));

if (!isConfigured) {
  document.querySelector('.auth-card').classList.add('hidden');
  $('notConfigured').classList.remove('hidden');
} else {
  init();
}

// Shown once on the sign-in page after a new password was saved (set just before the reset session is signed out;
// a link can't produce this message by itself).
const RESET_DONE = 'sparkscribe.resetDone';

async function init() {
  const requested = params.get('mode');
  let session = await getUser(); // server-verified; clears a stale local session
  // A password-reset session (lib/recovery.js) is only for the "choose a new password" form, and only while the link is
  // fresh. Anywhere else on this page (or once it's old) it is signed out here, so the page works as signed out.
  const local = session ? await currentSession() : null;
  if (session && recoveryAge(local) != null && !(requested === 'update' && isFreshRecovery(local))) {
    await endSession();
    session = null;
  }
  // no account menu beside the new-password form: the reset session isn't a sign-in
  if (!session || recoveryAge(local) == null) mountAccountMenu($('accountSlot'));
  // back (or forward) to a page kept in memory after signing out: show it as it is now
  window.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
  let done = null;
  try { done = JSON.parse(sessionStorage.getItem(RESET_DONE) || 'null'); sessionStorage.removeItem(RESET_DONE); } catch {}
  if (params.get('reset') === 'done') history.replaceState(null, '', `/auth${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`);
  if (!session && done && Date.now() - done.at < 600_000) {
    setMode('signin');
    if (done.email) $('email').value = done.email;
    showMsg('Password updated successfully. Please sign in with your new password.', 'success');
    $('password').focus();
  } else if (session && !hasConsent(session) && requested !== 'update') {
    setMode('consent');
  } else if (requested === 'consent' && !session) {
    setMode('signin');
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
    setMode(requested === 'signup' ? 'signup' : 'signin');
  }

  // Google appears only when the provider is really on; a disabled button looked like a broken sign-in path
  authSettings().then((s) => { googleOn = !!s?.external?.google; showGoogle(); });

  document.querySelectorAll('#authTabs button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('forgotLink').addEventListener('click', (e) => { e.preventDefault(); setMode('forgot'); });
  $('backToSignin').addEventListener('click', (e) => { e.preventDefault(); setMode('signin'); });
  $('googleBtn').addEventListener('click', google);
  $('authForm').addEventListener('submit', submit);
  $('consentSignOut')?.addEventListener('click', async (e) => { e.preventDefault(); await signOut(); location.replace('/'); });
  // leaving the password form without saving: the reset session ends here
  $('cancelReset')?.addEventListener('click', async (e) => { e.preventDefault(); await endSession(); location.replace('/auth'); });
}

function setMode(m) {
  mode = m;
  const cfg = MODES[m];
  $('authTitle').textContent = cfg.title;
  $('authSub').textContent = cfg.sub;
  $('submitBtn').textContent = cfg.submit;
  document.querySelectorAll('#authTabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  $('authTabs').classList.toggle('hidden', m === 'forgot' || m === 'update' || m === 'consent');
  const social = m === 'signin' || m === 'signup';
  socialMode = social;
  showGoogle();
  document.querySelector('.auth-or').classList.toggle('hidden', !social);
  $('emailField').classList.toggle('hidden', m === 'update' || m === 'consent');
  $('passwordField').classList.toggle('hidden', m === 'forgot' || m === 'consent');
  $('forgotLink').classList.toggle('hidden', m !== 'signin');
  $('confirmField').classList.toggle('hidden', !(m === 'signup' || m === 'update'));
  $('authLegal')?.classList.toggle('hidden', m !== 'signup');
  $('ageField').classList.toggle('hidden', m !== 'signup' && m !== 'consent');
  $('consentSignOut')?.classList.toggle('hidden', m !== 'consent');
  $('cancelReset')?.classList.toggle('hidden', m !== 'update');
  $('password').autocomplete = m === 'signin' ? 'current-password' : 'new-password';
  $('backToSignin').classList.toggle('hidden', m !== 'forgot');
  if (needsCaptcha(m) && !captcha) captcha = createCaptcha($('captchaSlot'), { action: 'auth' });
  $('captchaSlot').classList.toggle('hidden', !needsCaptcha(m));
  hideMsg();
}

// A fresh single-use token for one Supabase request (undefined when Turnstile is off). If the check can't produce one
// (Cloudflare unreachable, a blocker, a host not allowed for the widget), the request is still sent, without a token:
// Supabase is the only gate. While its CAPTCHA protection is off, people sign in as usual (nobody is locked out by a
// widget problem); once it's on, Supabase refuses the request and the page explains what went wrong with the check.
let captchaProblem = null;
async function captchaToken() {
  captchaProblem = null;
  // Cloudflare is showing its checkbox: say so, rather than leave the person waiting on a busy button
  if ($('captchaSlot')?.classList.contains('is-interactive')) showMsg('Please tick “Verify you are human” above to continue.', 'note');
  try { return await captcha?.token(); } catch (err) {
    captchaProblem = err instanceof CaptchaError ? err.message : 'We couldn’t complete the security check. Please try again.';
    return undefined;
  }
}

function showMsg(text, kind = 'note', resendTo = null) { // kinds: note, error, success ('info' is a global tooltip class)
  const el = $('authMsg');
  el.textContent = text;
  el.className = `auth-msg ${kind}`;
  if (resendTo) {
    // the confirmation email didn't arrive (spam, typo-free but slow, or expired): ask for a fresh one
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'auth-resend';
    b.textContent = 'Send the link again';
    b.addEventListener('click', () => resend(resendTo, b));
    el.append(' ', b);
  }
}
async function resend(email, btn) {
  btn.disabled = true;
  const token = await captchaToken();
  const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: callbackUrl(next), captchaToken: token } });
  captcha?.reset();
  if (error) { btn.disabled = false; return showMsg(explain(error), 'error'); }
  showMsg(`Sent again to ${email}. It can take a few minutes; check spam too. The link works in this browser.`, 'success');
}
function hideMsg() { $('authMsg').className = 'auth-msg hidden'; }

function busy(on) {
  $('submitBtn').disabled = on;
  $('submitBtn').classList.toggle('loading', on);
}

// Supabase error messages, made friendlier where it matters.
function explain(error) {
  const msg = error?.message || String(error);
  if (isCaptchaRejection(error)) return captchaProblem || CAPTCHA_REJECTED;
  if (error?.code === 'same_password' || /different from the old password/i.test(msg)) return 'Choose a password that’s different from your current one.';
  if (error?.code === 'weak_password' || /weak|pwned|leaked/i.test(msg)) return 'Choose a stronger password: this one is too easy to guess or has appeared in a data breach.';
  if (error?.name === 'AuthSessionMissingError' || /session missing|session_not_found|refresh token/i.test(msg)) return 'Your reset link has expired. Request a new one below.';
  if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(msg)) return 'Please confirm your email first. Check your inbox (and spam) for the link we sent.';
  // the email service refused or failed: not the user's fault, and retrying right away rarely helps
  if (/not authori[sz]ed|error sending|sending (confirmation|recovery|magic link)|smtp/i.test(msg)) return "We couldn't send the email just now. Please try again in a few minutes; if it keeps happening, contact support.";
  if (/already registered|already exists/i.test(msg)) return 'An account with this email already exists. Try signing in.';
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.';
  if (/redirect/i.test(msg)) return `${msg} (The site address may not be allowed in the Supabase auth settings yet.)`;
  return msg;
}

async function submit(e) {
  e.preventDefault();
  hideMsg();
  const email = $('email').value.trim();
  const password = $('password').value;
  const confirm = $('confirm').value;

  if (mode === 'consent') {
    if (!$('ageOk').checked) return showMsg('Please confirm you’re 13 or older and agree to the Terms to continue.', 'error');
    busy(true);
    try { await recordConsent(); location.replace(next); } catch (err) { showMsg(explain(err), 'error'); busy(false); }
    return;
  }
  if (mode !== 'update' && !/^\S+@\S+\.\S+$/.test(email)) return showMsg('Enter a valid email address.', 'error');
  if ((mode === 'signin' || mode === 'signup' || mode === 'update') && password.length < 8) return showMsg('Passwords need at least 8 characters.', 'error');
  if ((mode === 'signup' || mode === 'update') && password !== confirm) return showMsg("The two passwords don't match.", 'error');
  if (mode === 'signup' && !$('ageOk').checked) return showMsg('Please confirm you’re 13 or older and agree to the Terms to create an account.', 'error');

  busy(true);
  // sign-in, sign-up and the reset email carry a Turnstile token (once Supabase's CAPTCHA protection is on, it insists)
  let token;
  if (needsCaptcha(mode)) token = await captchaToken();
  try {
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken: token } });
      if (error) throw error;
      location.replace(next);
    } else if (mode === 'signup') {
      // what the person confirmed, and when (kept with the account)
      const agreed = new Date().toISOString();
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: callbackUrl(next), captchaToken: token, data: { age_13_plus_confirmed_at: agreed, terms_accepted_at: agreed } } });
      if (error) throw error;
      if (data.session) return location.replace(next); // email confirmation is off
      // With confirmation on, Supabase deliberately gives the same answer for new and existing emails.
      showMsg(`Check ${email} for a confirmation link. Open it in this browser to finish creating your account.`, 'success', email);
      $('authForm').reset();
    } else if (mode === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl('/auth?mode=update'), captchaToken: token });
      if (error) throw error;
      showMsg(`If an account exists for ${email}, a reset link is on its way. Open it in this browser.`, 'success');
    } else if (mode === 'update') {
      // only a fresh reset session may set a password (another tab may have used it or signed out meanwhile)
      const live = await currentSession();
      if (!live || !isFreshRecovery(live)) {
        await endSession();
        setMode('forgot');
        return showMsg('Your reset link has expired. Request a new one below.', 'error');
      }
      const email = live.user?.email || '';
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        if (/session missing|session_not_found/i.test(error.message || '') || error.name === 'AuthSessionMissingError') { await endSession(); setMode('forgot'); }
        throw error;
      }
      // Saved. The reset session ends now (Supabase is asked to end the account's other sessions too) and the person
      // signs in again with the new password; history is replaced, so Back can't return to a signed-in page.
      try { sessionStorage.setItem(RESET_DONE, JSON.stringify({ at: Date.now(), email })); } catch {}
      await endSession({ everywhere: true });
      $('authForm').reset();
      location.replace('/auth?reset=done');
      return;
    }
  } catch (err) {
    showMsg(explain(err), 'error', mode === 'signin' && /email not confirmed/i.test(err?.message || '') ? email : null);
  } finally {
    busy(false);
    if (needsCaptcha(mode)) captcha?.reset(); // a token works once: get the next one ready for another attempt
  }
}

async function google() {
  hideMsg();
  // creating an account with Google needs the same confirmation (signing in to an existing one doesn't)
  if (mode === 'signup' && !$('ageOk').checked) return showMsg('Please confirm you’re 13 or older and agree to the Terms first.', 'error');
  // the tick travels with this browser to the callback, which records it on the new account (signing in to an
  // existing account that already confirmed changes nothing; one that hasn't is asked after signing in)
  try { if (mode === 'signup') sessionStorage.setItem(PENDING_CONSENT, String(Date.now())); else sessionStorage.removeItem(PENDING_CONSENT); } catch {}
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callbackUrl(next) } });
  if (error) showMsg(explain(error), 'error');
}
