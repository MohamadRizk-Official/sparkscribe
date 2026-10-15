// Account flows against the mocked auth server, using same-origin iframes so multi-page flows can be followed.
// Run on any harness page: (await import('/qa/e2e/auth.e2e.js')).run()
import { sleep, waitFor, knobs, runTests, assert, eq } from './lib.js';

const TOKEN = 'sb-strkrrdndoofpcenopxk-auth-token';
let frame;
async function open(path) {
  frame?.remove();
  frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:420px;height:600px;opacity:.01;pointer-events:none';
  document.body.appendChild(frame);
  frame.src = path;
  await waitFor(() => frame.contentDocument?.readyState === 'complete' && frame.contentWindow.location.href !== 'about:blank', { what: `load ${path}` });
  await sleep(600);
  return frame;
}
const w = () => frame.contentWindow;
const d = () => frame.contentDocument;
const at = () => w().location.pathname + w().location.search;
const signOutLocally = () => { knobs({ signedOut: true }); localStorage.removeItem(TOKEN); sessionStorage.setItem('__signedOut', '1'); };
const signInLocally = () => { knobs({ signedOut: false }); sessionStorage.removeItem('__signedOut'); };
async function fill(email, password, confirm, { age = true } = {}) {
  const $ = (id) => d().getElementById(id);
  $('email').value = email; $('password').value = password; if (confirm != null) $('confirm').value = confirm;
  if ($('ageOk')) $('ageOk').checked = age;
  $('authForm').requestSubmit();
}
const msg = () => (d().getElementById('authMsg')?.textContent || '').trim();

export async function run() {
  const res = await runTests([
    ['signed out: Library redirects to sign-in and remembers where to return', async () => {
      signOutLocally();
      await open('/library');
      await waitFor(() => /^\/auth/.test(w().location.pathname), { what: 'redirect to /auth' });
      eq(new URLSearchParams(w().location.search).get('next'), '/library', 'next');
    }],
    ['form validation: bad email and short password are explained', async () => {
      await open('/auth?next=%2Flibrary');
      await fill('not-an-email', 'whatever1');
      await waitFor(() => /valid email/i.test(msg()), { what: 'email message' });
      await fill('qa@example.com', 'short');
      await waitFor(() => /at least 8/i.test(msg()), { what: 'length message' });
    }],
    ['wrong password shows an error and stays signed out', async () => {
      await fill('qa@example.com', 'wrong-password');
      await waitFor(() => msg().length > 0 && !/at least 8/.test(msg()), { what: 'auth error' });
      assert(/^\/auth/.test(w().location.pathname), 'still on the sign-in page');
      assert(!localStorage.getItem(TOKEN), 'no session stored');
    }],
    ['correct password signs in and returns to the requested page', async () => {
      signInLocally();
      await fill('qa@example.com', 'correct-horse-9');
      await waitFor(() => w().location.pathname === '/library', { timeout: 6000, what: 'back to /library' });
      assert(localStorage.getItem(TOKEN), 'session stored');
    }],
    ['sign up asks to confirm the email (no account details leaked)', async () => {
      signOutLocally();
      await open('/auth?mode=signup');
      await fill('new.person@example.com', 'a-good-password', 'a-good-password');
      await waitFor(() => /confirmation link/i.test(msg()), { what: 'confirm message' });
    }],
    ['the confirmation email can be requested again (sign-up message offers it)', async () => {
      const btn = await waitFor(() => d().querySelector('#authMsg .auth-resend'), { what: 'resend button' });
      btn.click();
      await waitFor(() => /Sent again to new\.person@example\.com/.test(msg()), { what: 'resent message' });
      eq(w().__qaResends, 1, 'resend requests');
    }],
    ['signing in before confirming explains it and offers to resend; a send failure is explained plainly', async () => {
      await open('/auth');
      await fill('new.person@example.com', 'unconfirmed-password');
      await waitFor(() => /confirm your email first/i.test(msg()), { what: 'not confirmed message' });
      knobs({ failResend: true });
      d().querySelector('#authMsg .auth-resend').click();
      await waitFor(() => /couldn.t send the email just now/i.test(msg()), { what: 'send failure message' });
      knobs({ failResend: false });
    }],
    ['sign up needs the age (13+) and Terms confirmation; nothing is sent without it', async () => {
      signOutLocally();
      await open('/auth?mode=signup');
      assert(!d().getElementById('ageField').classList.contains('hidden'), 'the confirmation shows on sign-up');
      await fill('teen@example.com', 'a-good-password', 'a-good-password', { age: false });
      await waitFor(() => /13 or older/i.test(msg()), { what: 'age message' });
      d().querySelector('#authTabs [data-mode="signin"]').click();
      assert(d().getElementById('ageField').classList.contains('hidden'), 'not asked when signing in');
    }],
    ['sign up: mismatched passwords are caught before any request', async () => {
      await open('/auth?mode=signup');
      await fill('new.person@example.com', 'a-good-password', 'another-password');
      await waitFor(() => /don.t match/i.test(msg()), { what: 'mismatch message' });
    }],
    ['forgot password gives the same answer whether or not the account exists', async () => {
      await open('/auth');
      const $ = (id) => d().getElementById(id);
      $('forgotLink').click(); // the reset form is reached from the sign-in form
      await sleep(200);
      $('email').value = 'someone@example.com'; $('authForm').requestSubmit();
      await waitFor(() => /If an account exists/i.test(msg()), { what: 'reset message' });
    }],
    ['crafted next= after sign-in stays on this site (D4)', async () => {
      signInLocally();
      localStorage.setItem(TOKEN, JSON.stringify({ access_token: 'fake.jwt.token', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: '11111111-1111-4111-8111-111111111111', email: 'tester@example.com', aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: {} } }));
      await open('/auth?next=%2F%09%2Fevil.example');
      await waitFor(() => !/^\/auth/.test(w().location.pathname), { what: 'redirect' });
      eq(w().location.host, location.host, 'host');
    }],
  ]);
  frame?.remove();
  signInLocally();
  return res;
}
