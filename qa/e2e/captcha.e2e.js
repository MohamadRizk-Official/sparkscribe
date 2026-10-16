// Cloudflare Turnstile on the auth flows (lib/captcha.js), in the QA harness.
//   run(): on the captcha-harness (a build WITH a Site Key; the harness's Turnstile stand-in via the `turnstile` knob):
//          (await import('/qa/e2e/captcha.e2e.js')).run()
//   off(): on an ordinary harness (a build WITHOUT a Site Key): (await import('/qa/e2e/captcha.e2e.js')).off()
// Supabase's CAPTCHA check is imitated by the browser mock (knob captchaRequired: a valid, unused token is required).
import { sleep, waitFor, knobs, runTests, assert, eq } from './lib.js';

const TOKEN = 'sb-strkrrdndoofpcenopxk-auth-token';
let frame;
async function open(path) {
  frame?.remove();
  frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:420px;height:700px;opacity:.01;pointer-events:none';
  document.body.appendChild(frame);
  frame.src = path;
  await waitFor(() => frame.contentDocument?.readyState === 'complete' && frame.contentWindow.location.href !== 'about:blank', { what: `load ${path}` });
  await sleep(500);
  return frame;
}
const w = () => frame.contentWindow;
const d = () => frame.contentDocument;
const $ = (id) => d().getElementById(id);
const msg = () => ($('authMsg')?.textContent || '').trim();
const sent = () => JSON.parse(sessionStorage.getItem('__qaCaptcha') || '[]');
const clearSent = () => sessionStorage.removeItem('__qaCaptcha');
const signOutLocally = () => { knobs({ signedOut: true }); localStorage.removeItem(TOKEN); sessionStorage.setItem('__signedOut', '1'); };
const signInLocally = () => { knobs({ signedOut: false }); sessionStorage.removeItem('__signedOut'); };
function fill(email, password, confirm, { age = true } = {}) {
  $('email').value = email; $('password').value = password; if (confirm != null) $('confirm').value = confirm;
  if ($('ageOk')) $('ageOk').checked = age;
  $('authForm').requestSubmit();
}
const reset = (k = {}) => { knobs({ turnstile: 'pass', captchaRequired: true, captchaRejectNext: false, failResend: false, ...k }); clearSent(); };

export async function run() {
  const res = await runTests([
    ['sign in: the request carries a Turnstile token; the widget is Managed, invisible unless needed', async () => {
      reset(); signOutLocally();
      await open('/auth?next=%2Flibrary');
      const st = w().__qaTurnstile;
      assert(st?.renders === 1, 'one widget rendered');
      eq(st.lastOptions.appearance, 'interaction-only', 'appearance');
      eq(st.lastOptions.size, 'flexible', 'size (fits narrow screens)');
      eq(st.lastOptions.action, 'auth', 'action');
      assert(/^[0-9A-Za-z_-]{10,}$/.test(st.lastOptions.sitekey), 'the public Site Key from VITE_TURNSTILE_SITE_KEY');
      signInLocally();
      fill('qa@example.com', 'correct-horse-9');
      await waitFor(() => w().location.pathname === '/library', { what: 'signed in', timeout: 8000 });
      const s = sent();
      assert(s.length === 1 && s[0].path === '/auth/v1/token' && /^qa-token-[a-z0-9]+-\d+$/.test(s[0].token), `token sent: ${JSON.stringify(s)}`);
    }],
    ['a failed attempt gets a fresh token for the next one (tokens are never reused)', async () => {
      reset(); signOutLocally();
      await open('/auth');
      fill('qa@example.com', 'wrong-password');
      await waitFor(() => /wrong email or password/i.test(msg()), { what: 'wrong password' });
      signInLocally();
      fill('qa@example.com', 'correct-horse-9');
      await waitFor(() => w().location.pathname !== '/auth', { what: 'signed in', timeout: 8000 });
      const s = sent();
      assert(s.length === 2 && s[0].token && s[1].token && s[0].token !== s[1].token, `two different tokens: ${s.map((x) => x.token)}`);
    }],
    ['sign up and "send the link again": each carries its own token; the age/Terms tick is still required', async () => {
      reset(); signOutLocally();
      await open('/auth?mode=signup');
      fill('new.person@example.com', 'a-good-password', 'a-good-password', { age: false });
      await waitFor(() => /13 or older/i.test(msg()), { what: 'tick still required' });
      eq(sent().length, 0, 'nothing sent without the tick');
      fill('new.person@example.com', 'a-good-password', 'a-good-password');
      await waitFor(() => /confirmation link/i.test(msg()), { what: 'check your email' });
      const btn = await waitFor(() => d().querySelector('#authMsg .auth-resend'), { what: 'resend button' });
      btn.click();
      await waitFor(() => /Sent again/i.test(msg()), { what: 'resent' });
      const s = sent();
      assert(s.map((x) => x.path).join() === '/auth/v1/signup,/auth/v1/resend' && s[0].token !== s[1].token && s.every((x) => /^qa-token-/.test(x.token)), JSON.stringify(s));
    }],
    ['password reset email carries a token', async () => {
      reset(); signOutLocally();
      await open('/auth');
      $('forgotLink').click();
      await sleep(200);
      $('email').value = 'someone@example.com'; $('authForm').requestSubmit();
      await waitFor(() => /If an account exists/i.test(msg()), { what: 'reset sent' });
      const s = sent();
      assert(s.length === 1 && s[0].path === '/auth/v1/recover' && /^qa-token-/.test(s[0].token), JSON.stringify(s));
    }],
    ['Supabase rejects a token: a plain message, nothing else happens, and the next try works', async () => {
      reset({ captchaRejectNext: true }); signOutLocally();
      await open('/auth');
      fill('qa@example.com', 'correct-horse-9');
      await waitFor(() => /security check didn.t go through/i.test(msg()), { what: 'captcha rejection message' });
      eq(w().location.pathname, '/auth', 'still on the sign-in page');
      signInLocally();
      fill('qa@example.com', 'correct-horse-9');
      await waitFor(() => w().location.pathname !== '/auth', { what: 'signed in on retry', timeout: 8000 });
    }],
    ['Cloudflare can\'t complete the check: explained, and no request reaches Supabase', async () => {
      reset({ turnstile: 'fail' }); signOutLocally();
      await open('/auth');
      fill('qa@example.com', 'correct-horse-9');
      await waitFor(() => /couldn.t complete the security check/i.test(msg()), { what: 'failure message', timeout: 10000 });
      eq(sent().length, 0, 'no sign-in request without a token');
      assert(!$('submitBtn').disabled, 'the button works again');
    }],
    ['an expired token is never sent: the refreshed one is', async () => {
      reset({ turnstile: 'expire' }); signOutLocally();
      await open('/auth');
      await waitFor(() => w().__qaTurnstile?.issued >= 2, { what: 'token expired and refreshed', timeout: 5000 });
      signInLocally();
      fill('qa@example.com', 'correct-horse-9');
      await waitFor(() => w().location.pathname !== '/auth', { what: 'signed in', timeout: 8000 });
      assert(/-2$/.test(sent()[0]?.token || ''), `the fresh token (the second one issued): ${sent()[0]?.token}`);
    }],
    ['submitting before the check has finished waits for it (button busy), then signs in', async () => {
      reset({ turnstile: 'slow' }); signOutLocally();
      await open('/auth');
      signInLocally();
      fill('qa@example.com', 'correct-horse-9');
      await sleep(400);
      assert($('submitBtn').disabled && sent().length === 0, 'waiting for the token, nothing sent yet');
      await waitFor(() => w().location.pathname !== '/auth', { what: 'signed in after the check', timeout: 10000 });
      assert(/^qa-token-/.test(sent()[0]?.token), 'with its token');
    }],
    ['when Cloudflare asks for a click, the widget shows (and hides again afterwards)', async () => {
      reset({ turnstile: 'interactive' }); signOutLocally();
      await open('/auth');
      await waitFor(() => $('captchaSlot').classList.contains('is-interactive'), { what: 'interactive shown' });
      await waitFor(() => !$('captchaSlot').classList.contains('is-interactive'), { what: 'interactive done', timeout: 3000 });
      assert(!$('captchaSlot').classList.contains('hidden'), 'slot visible in sign-in');
    }],
    ['no widget for setting a new password or the age/Terms step (no CAPTCHA there)', async () => {
      reset(); signOutLocally();
      await open('/auth');
      $('forgotLink').click(); await sleep(100);
      assert(!$('captchaSlot').classList.contains('hidden'), 'forgot: shown');
      signInLocally();
      knobs({ noConsent: true });
      await open('/auth?mode=consent&next=%2Flibrary');
      await waitFor(() => /One more step/.test($('authTitle').textContent), { what: 'consent step' });
      assert($('captchaSlot').classList.contains('hidden'), 'consent: no widget');
      $('ageOk').checked = true; $('authForm').requestSubmit();
      await waitFor(() => w().location.pathname === '/library', { what: 'consent recorded' });
      knobs({ noConsent: false });
      eq(sent().length, 0, 'no CAPTCHA request for the confirmation');
    }],
    ['Google sign-in is not held up by the check (it isn\'t CAPTCHA-protected)', async () => {
      reset({ googleOn: true }); signOutLocally();
      await open('/auth?mode=signup');
      const g = await waitFor(() => !$('googleWrap').classList.contains('hidden') && $('googleBtn'), { what: 'Google button' });
      g.click();
      await waitFor(() => /13 or older/i.test(msg()), { what: 'tick required for a new Google account' });
      $('ageOk').checked = true;
      g.click();
      // the browser leaves for Google straight away (the frame becomes another origin)
      await waitFor(() => { try { return !/\/auth/.test(w().location.pathname); } catch { return true; } }, { what: 'redirected to Google', timeout: 5000 });
      eq(sent().length, 0, 'no CAPTCHA request');
      knobs({ googleOn: false });
    }],
  ]);
  frame?.remove();
  knobs({ turnstile: null, captchaRequired: false, signedOut: false });
  sessionStorage.removeItem('__signedOut');
  return res;
}

// A build without a Site Key: nothing is loaded, no token is sent, and sign-in works as before. (If Supabase's CAPTCHA
// were switched on while such a build is live, sign-in would fail: the reason for the activation order.)
export async function off() {
  const res = await runTests([
    ['no Site Key: no widget, no Cloudflare script, sign-in works without a token', async () => {
      knobs({ turnstile: null, captchaRequired: false }); clearSent(); signOutLocally();
      await open('/auth');
      assert(!d().querySelector('script[src*="challenges.cloudflare.com"]') && !w().turnstile, 'nothing loaded');
      signInLocally();
      fill('qa@example.com', 'correct-horse-9');
      await waitFor(() => w().location.pathname !== '/auth', { what: 'signed in', timeout: 8000 });
      eq(sent()[0]?.token ?? null, null, 'no token sent');
    }],
    ['…and if Supabase required CAPTCHA, this build could not sign in (so the frontend ships first)', async () => {
      knobs({ captchaRequired: true }); clearSent(); signOutLocally();
      await open('/auth');
      fill('qa@example.com', 'correct-horse-9');
      await waitFor(() => /security check didn.t go through/i.test(msg()), { what: 'refused' });
      knobs({ captchaRequired: false });
    }],
  ]);
  frame?.remove();
  signInLocally();
  return res;
}
