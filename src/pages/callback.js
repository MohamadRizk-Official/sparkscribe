// /auth/callback — where Google sign-in, email confirmation and password-reset links land.
// The Supabase client (PKCE + detectSessionInUrl) swaps the ?code= for a session on its own;
// getSession() waits for that to finish.
// Links in our own auth emails (docs/launch/email-templates) carry ?token_hash=…&type=… instead: nothing is used until
// the person presses the button, so mail scanners that open links before the reader (e.g. Outlook Safe Links) can't
// use them up, and they work in any browser, not only the one that asked for the email.
import { supabase, isConfigured } from '../lib/supabase.js';
import { safeNext, hasConsent, recordConsent, consentUrl } from '../lib/account.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.slice(1));
let next = safeNext(params.get('next'), '/');

const EMAIL_LINKS = {
  recovery: { title: 'Reset your password', text: 'Continue to choose a new password for your SparkScribe account.', btn: 'Continue' },
  signup: { title: 'Verify your email address', text: 'Confirm this email address to activate your SparkScribe account.', btn: 'Verify email address' },
  email: { title: 'Verify your email address', text: 'Confirm this email address to activate your SparkScribe account.', btn: 'Verify email address' },
  magiclink: { title: 'Sign in to SparkScribe', text: 'Continue to sign in to your account.', btn: 'Sign in' },
  invite: { title: 'Accept your invitation', text: 'Continue to join SparkScribe.', btn: 'Accept invitation' },
  email_change: { title: 'Confirm your new email address', text: 'Confirm the change of the email address on your SparkScribe account.', btn: 'Confirm email change' },
};
const USED_UP = 'It may have expired or been used already. Request a new one from the sign-in page.';

// a link from our emails: wait for the button, then verify (single use) -> true when signed in by it
function emailLink(tokenHash, type) {
  const copy = EMAIL_LINKS[type];
  if (!copy) { fail('This link didn’t work', 'Something went wrong with this link. Try signing in again.'); return null; }
  $('spinner').classList.add('hidden');
  $('cbTitle').textContent = copy.title;
  $('cbText').textContent = copy.text;
  const go = $('cbGo');
  go.textContent = copy.btn;
  go.classList.remove('hidden');
  go.focus();
  return new Promise((resolve) => {
    go.addEventListener('click', async () => {
      go.disabled = true;
      $('spinner').classList.remove('hidden');
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      history.replaceState(null, '', '/auth/callback'); // the used token leaves the address bar
      go.classList.add('hidden');
      if (error) { fail('This link didn’t work', USED_UP); return resolve(false); }
      // a change of address confirmed from one inbox, waiting for the other (Supabase's "secure email change")
      if (type === 'email_change' && !data.session) { fail('Almost done', 'Now open the link we sent to your other email address.'); $('cbBtn').textContent = 'Go to SparkScribe'; $('cbBtn').href = '/'; return resolve(false); }
      resolve(true);
    }, { once: true });
  });
}

function fail(title, text) {
  $('spinner').classList.add('hidden');
  $('cbTitle').textContent = title;
  $('cbText').textContent = text;
  $('cbBtn').classList.remove('hidden');
}

(async () => {
  if (!isConfigured) return fail('Accounts aren\'t available', 'This copy of the site isn\'t connected to an account server.');

  // only known errors are shown, in our words: a link can't put arbitrary text on this page
  const code = params.get('error_code') || hash.get('error_code') || params.get('error') || hash.get('error');
  if (code) {
    const known = {
      otp_expired: 'This link has expired or was already used. Request a new one from the sign-in page.',
      access_denied: 'Sign-in was cancelled or the link is no longer valid. Try again from the sign-in page.',
      email_not_confirmed: 'Confirm your email first: open the link we sent you.',
    };
    return fail("Couldn't sign you in", known[code] || 'Something went wrong with this link. Try signing in again.');
  }

  const tokenHash = params.get('token_hash');
  if (tokenHash) {
    const type = params.get('type');
    if (!(await emailLink(tokenHash, type))) return;
    if (type === 'recovery') next = '/auth?mode=update';
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    return fail(
      'This link didn\'t work',
      'It may have expired, been used already, or been opened in a different browser from the one you signed up in. Sign in again, or request a new link.',
    );
  }
  // A Google sign-in that created a new account: record the confirmation ticked on the sign-up tab of this browser
  // (within the last hour), or ask for it before anything else.
  const user = data.session.user;
  // a password-reset link goes straight to the new-password form (the age/Terms step, if needed, comes after the next
  // normal sign-in)
  if (next.startsWith('/auth?mode=update')) return location.replace(next);
  if (!hasConsent(user)) {
    let ticked = 0;
    try { ticked = Number(sessionStorage.getItem('sparkscribe.consentAt') || 0); sessionStorage.removeItem('sparkscribe.consentAt'); } catch {}
    if (ticked && Date.now() - ticked < 3_600_000) {
      try { await recordConsent(); return location.replace(next); } catch { /* asked on the next page instead */ }
    }
    return location.replace(consentUrl(next));
  }
  location.replace(next);
})();
