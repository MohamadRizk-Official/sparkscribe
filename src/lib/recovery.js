// Password-reset ("recovery") sessions. Opening a reset link signs the browser in with a session whose newest sign-in
// method is "recovery". That session exists only so the person can choose a new password: it must not double as a way
// into the app. So:
//   * on /auth?mode=update, within RECOVERY_WINDOW_S of opening the link, it may set a new password;
//   * anywhere else, a fresh one is sent back to that form, and an older one is signed out in this browser;
//   * after the new password is saved, the session is signed out and the person signs in again (auth.js).
// The token's claims are read only to decide what to show; Supabase checks every request itself.
import { supabase } from './supabase.js';

export const RECOVERY_WINDOW_S = 900; // 15 minutes
const STORAGE_KEY = () => Object.keys(localStorage).find((k) => /^sb-[a-z0-9]+-auth-token$/.test(k));

function claimsOf(session) {
  try { return JSON.parse(atob(session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
}

// seconds since the reset link was opened, if this session came from one (its NEWEST sign-in is "recovery"); else null
export function recoveryAge(session) {
  const amr = claimsOf(session)?.amr;
  if (!Array.isArray(amr) || !amr.length) return null;
  const newest = amr.reduce((a, b) => (Number(b?.timestamp) > Number(a?.timestamp) ? b : a));
  if (newest?.method !== 'recovery') return null;
  return Math.max(0, Date.now() / 1000 - Number(newest.timestamp));
}
export const isFreshRecovery = (session) => { const age = recoveryAge(session); return age != null && age < RECOVERY_WINDOW_S; };

export async function currentSession() {
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

// End the session in this browser, whatever happens on the network. scope 'global' asks Supabase to end every session
// of the account (it revokes their refresh tokens; access tokens already issued elsewhere stay valid until they
// expire). If that request fails, this browser is still signed out.
export async function endSession({ everywhere = false } = {}) {
  let result = 'local';
  if (everywhere) {
    const { error } = await supabase.auth.signOut({ scope: 'global' }).catch((e) => ({ error: e }));
    if (!error) result = 'global';
  }
  if (result !== 'global') {
    const { error } = await supabase.auth.signOut({ scope: 'local' }).catch((e) => ({ error: e }));
    if (error) { try { const k = STORAGE_KEY(); if (k) localStorage.removeItem(k); } catch { /* storage blocked */ } }
  }
  return result;
}

// Pages other than the password form: a fresh recovery session goes back to the form; an older one is signed out
// here. -> true when the page is navigating away (stop rendering)
export async function guardRecovery(session, pathname = location.pathname) {
  if (!session || recoveryAge(session) == null || /^\/auth(\/|$)/.test(pathname)) return false;
  if (isFreshRecovery(session)) { location.replace('/auth?mode=update'); return true; }
  await endSession();
  location.reload();
  return true;
}

// ---- Reset links from our own emails (#token_hash=…&type=recovery) ----
// Supabase gives a session from such a link the sign-in method "otp", not "recovery", so it can't be told apart from a
// normal sign-in. So the link never becomes a session in this browser: callback.js keeps its token in this tab only
// (sessionStorage), the "choose a new password" form opens without any session, and the token is used once, when the
// new password is submitted, in a separate in-memory client (auth.js). Nothing here signs anyone in.
const RESET_LINK = 'sparkscribe.resetLink';
const RESET_LINK_MAX_MS = 60 * 60 * 1000; // the link's own lifetime in Supabase is 1 hour (mailer_otp_exp 3600)
export function keepResetLink(hash) {
  try { sessionStorage.setItem(RESET_LINK, JSON.stringify({ hash: String(hash), at: Date.now() })); return true; } catch { return false; }
}
export function peekResetLink() {
  try {
    const v = JSON.parse(sessionStorage.getItem(RESET_LINK) || 'null');
    if (v && typeof v.hash === 'string' && v.hash.length >= 10 && Date.now() - v.at < RESET_LINK_MAX_MS) return v;
  } catch { /* storage blocked */ }
  dropResetLink();
  return null;
}
// -> the link, removed from storage (single use)
export function takeResetLink() { const v = peekResetLink(); dropResetLink(); return v; }
export function dropResetLink() { try { sessionStorage.removeItem(RESET_LINK); } catch { /* storage blocked */ } }
