// /auth/callback — where Google sign-in, email confirmation and password-reset links land (docs/auth/README.md).
//
// Two kinds of link arrive here:
//   * ?code=…  Google sign-in, and email links that went through Supabase's own address ({{ .ConfirmationURL }}).
//     The Supabase client (PKCE + detectSessionInUrl) swaps the code for a session by itself; getSession() waits for it.
//     It only works in the browser that asked (that browser holds the PKCE verifier).
//   * #token_hash=…&type=…  links in our own email templates (docs/auth/email-templates). The token is in the fragment,
//     which browsers never send to a server (no request logs, no Referer); ?token_hash= works too. Nothing is used until the
//     person presses the button, so mail scanners that open links before the reader (e.g. Outlook Safe Links) can't
//     use them up, and they work in any browser.
//
// What each link may do:
//   * password reset, our link (#token_hash, type=recovery) -> NOT verified here. Its token is kept in this tab only and
//     the new-password form opens; the token is used once, together with the new password, in a separate in-memory
//     client (auth.js). Supabase would record such a session as "otp" (indistinguishable from a sign-in), so the link
//     never becomes a session in this browser at all.
//   * password reset, Supabase's ?code= link -> a reset session that only reaches the new-password form (lib/recovery.js)
//   * email verification (sign-up) -> the address is confirmed, this browser is NOT left signed in by the link: the
//     person signs in with their password next ("Email verified. Please sign in.")
//   * Google sign-in   -> signed in, as before
import { supabase, isConfigured, isolatedClient } from '../lib/supabase.js';
import { safeNext, getSession, hasConsent, recordConsent, consentUrl } from '../lib/account.js';
import { endSession, keepResetLink } from '../lib/recovery.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.slice(1));
const next = safeNext(params.get('next') || hash.get('next'), '/');
const RESET_FORM = '/auth?mode=update';
const VERIFIED = 'sparkscribe.verified'; // read once by auth.js

function fail(title, text, { href = '/auth', label = 'Back to sign in' } = {}) {
  $('spinner').classList.add('hidden');
  $('cbGo').classList.add('hidden');
  $('cbTitle').textContent = title;
  $('cbText').textContent = text;
  $('cbBtn').textContent = label;
  $('cbBtn').href = href;
  $('cbBtn').classList.remove('hidden');
}
const USED_UP = 'It may have expired or been used already. Request a new one from the sign-in page.';

// the address is confirmed: off to the sign-in page, which says so (and fills in the email)
function verifiedSignIn(email) {
  try { sessionStorage.setItem(VERIFIED, JSON.stringify({ at: Date.now(), email: email || '' })); } catch {}
  location.replace(`/auth?verified=1${next !== '/' ? `&next=${encodeURIComponent(next)}` : ''}`);
}

const EMAIL_LINKS = {
  recovery: { title: 'Reset your password' }, // handled without a button (see emailLink)
  signup: { title: 'Verify your email address', text: 'Confirm this email address to activate your SparkScribe account.', btn: 'Verify email address' },
  email: { title: 'Verify your email address', text: 'Confirm this email address to activate your SparkScribe account.', btn: 'Verify email address' },
  magiclink: { title: 'Sign in to SparkScribe', text: 'Continue to sign in to your account.', btn: 'Sign in' },
  invite: { title: 'Accept your invitation', text: 'Continue to confirm your email address for SparkScribe.', btn: 'Accept invitation' },
  email_change: { title: 'Confirm your new email address', text: 'Confirm the change of the email address on your SparkScribe account.', btn: 'Confirm email change' },
};

// a link from our emails: wait for the button, then verify (single use)
function waitForButton(copy) {
  document.title = `${copy.title} — SparkScribe`;
  $('spinner').classList.add('hidden');
  $('cbTitle').textContent = copy.title;
  $('cbText').textContent = copy.text;
  const go = $('cbGo');
  go.textContent = copy.btn;
  go.classList.remove('hidden');
  go.focus();
  return new Promise((resolve) => go.addEventListener('click', () => {
    go.disabled = true; // one press, one request
    $('spinner').classList.remove('hidden');
    resolve();
  }, { once: true }));
}

async function emailLink(tokenHash, type) {
  const copy = EMAIL_LINKS[type];
  if (!copy) return fail('This link didn’t work', 'Something went wrong with this link. Request a new one from the sign-in page.');
  if (type === 'recovery') {
    // nothing is used here (a scanner opening the link changes nothing): straight to the form, token kept in this tab
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(tokenHash) || !keepResetLink(tokenHash)) return fail('This link didn’t work', USED_UP);
    return location.replace(RESET_FORM); // replace: the token leaves the address bar and the history
  }
  await waitForButton(copy);
  history.replaceState(null, '', '/auth/callback'); // the token leaves the address bar before it is used

  if (type === 'magiclink') {
    // a sign-in link signs this browser in
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return fail('This link didn’t work', USED_UP);
    return location.replace(next);
  }

  // Confirmations: checked in a separate in-memory session that is signed out right after, so whoever is signed in
  // in this browser stays as they are, and the link itself never signs anyone in.
  const iso = isolatedClient();
  const { data, error } = await iso.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) return fail('This link didn’t work', USED_UP);
  const confirmed = data.user || data.session?.user || null;
  if (data.session) await iso.auth.signOut({ scope: 'local' }).catch(() => {}); // ends that session on the server too
  if (type === 'email_change') {
    if (!data.session && !confirmed) return fail('Almost done', 'Now open the link we sent to your other email address.', { href: '/', label: 'Go to SparkScribe' });
    return fail('Email address updated', 'Sign in with your new email address from now on.', { href: '/auth', label: 'Go to sign in' });
  }
  if (type === 'invite') return fail('Invitation accepted', 'Choose a password to finish: use “Forgot password?” on the sign-in page with this email address.', { href: '/auth?mode=forgot', label: 'Choose a password' });
  // signup / email: verified. If another account is signed in here, leave it alone and say so.
  const here = await getSession();
  if (here && here.user?.id !== confirmed?.id) {
    return fail('Email verified', `${confirmed?.email || 'The new account'} is ready. You’re signed in here as ${here.user?.email || 'another account'}; sign out first to use the new one.`, { href: '/', label: 'Go to SparkScribe' });
  }
  if (here) return location.replace(next); // the same person, already signed in
  verifiedSignIn(confirmed?.email);
}

(async () => {
  if (!isConfigured) return fail('Accounts aren\'t available', 'This copy of the site isn\'t connected to an account server.', { href: '/', label: 'Go to the transcriber' });

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

  const tokenHash = hash.get('token_hash') || params.get('token_hash');
  if (tokenHash) return emailLink(tokenHash, hash.get('type') || params.get('type'));

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    return fail(
      'This link didn\'t work',
      'It may have expired, been used already, or been opened in a different browser from the one you asked for it in. Sign in again, or request a new link.',
    );
  }
  // a password-reset link goes straight to the new-password form (lib/recovery.js keeps it there)
  if (next.startsWith(RESET_FORM)) return location.replace(next);
  // a sign-up confirmation through Supabase's own link: the address is confirmed; the session the link created ends
  // here and the person signs in with their password
  if (params.get('flow') === 'signup') {
    const email = data.session.user?.email;
    await endSession();
    return verifiedSignIn(email);
  }
  // A Google sign-in that created a new account: record the age/Terms confirmation ticked on the sign-up tab of this
  // browser (within the last hour), or ask for it before anything else.
  if (!hasConsent(data.session.user)) {
    let ticked = 0;
    try { ticked = Number(sessionStorage.getItem('sparkscribe.consentAt') || 0); sessionStorage.removeItem('sparkscribe.consentAt'); } catch {}
    if (ticked && Date.now() - ticked < 3_600_000) {
      try { await recordConsent(); return location.replace(next); } catch { /* asked on the next page instead */ }
    }
    return location.replace(consentUrl(next));
  }
  location.replace(next);
})();
