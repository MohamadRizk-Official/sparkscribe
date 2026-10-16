// /auth/callback — where Google sign-in, email confirmation and password-reset links land.
// The Supabase client (PKCE + detectSessionInUrl) swaps the ?code= for a session on its own;
// getSession() waits for that to finish.
import { supabase, isConfigured } from '../lib/supabase.js';
import { safeNext, hasConsent, recordConsent, consentUrl } from '../lib/account.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.slice(1));
const next = safeNext(params.get('next'), '/');

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
