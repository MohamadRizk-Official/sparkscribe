// /auth — sign in, create account, forgot password, and set a new password (after a reset link).
import { supabase, isConfigured, authSettings } from '../lib/supabase.js';
import { mountAccountMenu, safeNext, getUser, hasConsent, recordConsent, signOut } from '../lib/account.js';

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
const showGoogle = () => $('googleWrap').classList.toggle('hidden', !(googleOn && socialMode));

if (!isConfigured) {
  document.querySelector('.auth-card').classList.add('hidden');
  $('notConfigured').classList.remove('hidden');
} else {
  init();
}

// The current session was started by a password-reset link in the last 15 minutes (the token records how it
// was obtained: method "recovery").
async function cameFromResetLink() {
  try {
    const { data } = await supabase.auth.getSession();
    const claims = JSON.parse(atob(data.session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return (claims.amr || []).some((a) => a?.method === 'recovery' && Date.now() / 1000 - Number(a.timestamp) < 900);
  } catch { return false; }
}

async function init() {
  const requested = params.get('mode');
  const session = await getUser(); // server-verified; clears a stale local session
  mountAccountMenu($('accountSlot'));
  if (session && !hasConsent(session) && requested !== 'update') {
    setMode('consent');
  } else if (requested === 'consent' && !session) {
    setMode('signin');
  } else if (requested === 'update') {
    // Setting a new password needs the reset link from the email: a session that merely exists (a shared
    // computer, a stolen token) can't change the password and lock the owner out.
    if (!session || !(await cameFromResetLink())) {
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
  $('password').autocomplete = m === 'signin' ? 'current-password' : 'new-password';
  $('backToSignin').classList.toggle('hidden', m !== 'forgot');
  hideMsg();
}

function showMsg(text, kind = 'info', resendTo = null) {
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
  const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: callbackUrl(next) } });
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
  try {
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      location.replace(next);
    } else if (mode === 'signup') {
      // what the person confirmed, and when (kept with the account)
      const agreed = new Date().toISOString();
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: callbackUrl(next), data: { age_13_plus_confirmed_at: agreed, terms_accepted_at: agreed } } });
      if (error) throw error;
      if (data.session) return location.replace(next); // email confirmation is off
      // With confirmation on, Supabase deliberately gives the same answer for new and existing emails.
      showMsg(`Check ${email} for a confirmation link. Open it in this browser to finish creating your account.`, 'success', email);
      $('authForm').reset();
    } else if (mode === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl('/auth?mode=update') });
      if (error) throw error;
      showMsg(`If an account exists for ${email}, a reset link is on its way. Open it in this browser.`, 'success');
    } else if (mode === 'update') {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await supabase.auth.signOut({ scope: 'others' }).catch(() => {}); // anyone else signed in to this account is signed out
      showMsg('Password updated. Taking you to your library…', 'success');
      setTimeout(() => location.replace('/library'), 900);
    }
  } catch (err) {
    showMsg(explain(err), 'error', mode === 'signin' && /email not confirmed/i.test(err?.message || '') ? email : null);
  } finally {
    busy(false);
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
