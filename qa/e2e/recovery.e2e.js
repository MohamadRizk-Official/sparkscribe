// Password reset end to end in the harness (mocked Supabase Auth; knob `recovery` = a session started by a reset link):
// the reset session only reaches the new-password form, saving signs it out and the person signs in again, Back /
// Forward / Refresh never return to a signed-in state, expired and spoofed states, callback errors and redirects.
// Run from the blank host page (an app page in the same browser would follow the reset session too):
//   open /qa/e2e/host.html on the harness, then  (await import('/qa/e2e/recovery.e2e.js')).run()
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
  await sleep(700);
  return frame;
}
const w = () => frame.contentWindow;
const d = () => frame.contentDocument;
const $ = (id) => d().getElementById(id);
const at = () => { try { return w().location.pathname + w().location.search; } catch { return '(other origin)'; } };
const msg = () => ($('authMsg')?.textContent || '').trim();
const title = () => $('authTitle')?.textContent || '';
const logouts = () => JSON.parse(sessionStorage.getItem('__qaLogouts') || '[]');
const hasSession = () => !!localStorage.getItem(TOKEN);
// a browser that just opened the reset link: signed in with a recovery session
function resetLinkOpened(ageS = 0) {
  sessionStorage.removeItem('__signedOut');
  sessionStorage.removeItem('__qaLogouts');
  knobs({ signedOut: false, recovery: true, recoveryAgeS: ageS, samePassword: false });
  localStorage.setItem(TOKEN, JSON.stringify({ access_token: recoveryJwt(ageS), refresh_token: 'fake-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'tester@example.com', aud: 'authenticated', role: 'authenticated', user_metadata: { age_13_plus_confirmed_at: 'x', terms_accepted_at: 'x' }, app_metadata: { provider: 'email' } } }));
}
const b64u = (o) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const recoveryJwt = (ageS) => { const t = Math.floor(Date.now() / 1000) - ageS; return `${b64u({ alg: 'none' })}.${b64u({ sub: '11111111-1111-4111-8111-111111111111', amr: [{ method: 'password', timestamp: t - 86400 }, { method: 'recovery', timestamp: t }] })}.qa`; };
const verifies = () => JSON.parse(sessionStorage.getItem('__qaVerify') || '[]');
function signedOutBrowser() {
  localStorage.removeItem(TOKEN);
  sessionStorage.setItem('__signedOut', '1');
  knobs({ signedOut: true, recovery: false });
}
function fill(pw, confirm = pw) { $('password').value = pw; $('confirm').value = confirm; $('authForm').requestSubmit(); }

export async function run() {
  for (const k of ['__qaPassword', '__qaVerify', '__qaUsedHashes', '__qaPasswordViaLink', 'sparkscribe.resetLink']) sessionStorage.removeItem(k);
  const res = await runTests([
    ['the reset link opens the new-password form (no CAPTCHA there), with a way to cancel', async () => {
      resetLinkOpened();
      await open('/auth?mode=update');
      eq(title(), 'Choose a new password', 'form');
      assert(!$('cancelReset').classList.contains('hidden') && $('captchaSlot')?.classList.contains('hidden') !== false, 'cancel link shown; no widget');
      assert($('emailField').classList.contains('hidden'), 'no email field');
      assert(!$('accountSlot').children.length, 'no account menu (the reset session is not a sign-in)');
    }],
    ['while resetting, the reset session can\'t open the app: Library and Home go back to the form', async () => {
      resetLinkOpened();
      await open('/library');
      await waitFor(() => at() === '/auth?mode=update', { what: 'back to the form from /library' });
      await open('/');
      await waitFor(() => at() === '/auth?mode=update', { what: 'back to the form from /' });
    }],
    ['opening the sign-in page with a reset session ends it (no way in without a password)', async () => {
      resetLinkOpened();
      await open('/auth');
      await waitFor(() => title() === 'Welcome back', { what: 'sign-in form' });
      assert(!hasSession() && logouts().includes('local'), `reset session ended here (${logouts()})`);
    }],
    ['mismatched passwords and the current password are refused, and the form stays', async () => {
      resetLinkOpened();
      await open('/auth?mode=update');
      fill('a-new-password-1', 'something-else-1');
      await waitFor(() => /don.t match/i.test(msg()), { what: 'mismatch' });
      knobs({ samePassword: true });
      fill('the-same-password');
      await waitFor(() => /different from your current one/i.test(msg()), { what: 'same password refused' });
      knobs({ samePassword: false });
      eq(title(), 'Choose a new password', 'still on the form');
      assert(hasSession(), 'reset session still there to try again');
    }],
    ['saving signs the reset session out and asks to sign in with the new password (email filled in)', async () => {
      resetLinkOpened();
      await open('/qa/e2e/host.html');
      w().location.href = '/auth?mode=update'; // a real navigation, so Back has somewhere to go
      await waitFor(() => title() === 'Choose a new password', { what: 'form' });
      fill('brand-new-pass-9');
      await waitFor(() => /Password updated. Sign in with your new password./.test(msg()), { what: 'confirmation', timeout: 8000 });
      eq(at(), '/auth', 'the sign-in page, address cleaned');
      eq(title(), 'Welcome back', 'sign-in form');
      eq($('email').value, 'tester@example.com', 'email filled in');
      assert(!hasSession(), 'no session in this browser');
      eq(logouts()[0], 'global', 'Supabase asked to end the account\'s sessions');
      eq(sessionStorage.getItem('__qaPassword'), 'brand-new-pass-9', 'the new password was saved');
    }],
    ['Back goes to the page before the form, signed out; Forward shows sign-in; the app and the form stay closed', async () => {
      w().history.back();
      await waitFor(() => at() === '/qa/e2e/host.html', { what: 'back to the page before' });
      await sleep(600);
      assert(!hasSession(), 'still signed out');
      w().history.forward();
      await waitFor(() => at() === '/auth' && title() === 'Welcome back', { what: 'forward to sign-in' });
      await open('/library');
      await waitFor(() => at().startsWith('/auth?next=%2Flibrary'), { what: 'the app asks to sign in' });
      await open('/auth?mode=update');
      await waitFor(() => /expired or was already used/i.test(msg()), { what: 'reset link no longer works' });
      eq(title(), 'Reset your password', 'offers a new link');
    }],
    ['refreshing the sign-in page doesn\'t repeat the confirmation, and a crafted ?reset=done shows nothing', async () => {
      await open('/auth');
      eq(msg(), '', 'no message on reload');
      await open('/auth?reset=done');
      eq(msg(), '', 'nothing from the link alone');
    }],
    ['the old password no longer works; the new one signs in normally', async () => {
      knobs({ signedOut: true });
      await open('/auth?next=%2Flibrary');
      $('email').value = 'tester@example.com'; $('password').value = 'correct-horse-9'; $('authForm').requestSubmit();
      await waitFor(() => /incorrect email or password/i.test(msg()), { what: 'old password refused' });
      $('password').value = 'brand-new-pass-9'; $('authForm').requestSubmit();
      await waitFor(() => at() === '/library', { what: 'signed in with the new password', timeout: 8000 });
      await sleep(800);
      eq(at(), '/library', 'stays in the app (a normal session, not a reset one)');
    }],
    ['a reset session older than 15 minutes is signed out (Library), and the form says the link expired', async () => {
      resetLinkOpened(1200);
      await open('/library');
      await waitFor(() => at().startsWith('/auth?next=%2Flibrary'), { what: 'signed out, asked to sign in', timeout: 8000 });
      assert(!hasSession(), 'session gone');
      resetLinkOpened(1200);
      await open('/auth?mode=update');
      await waitFor(() => /expired or was already used/i.test(msg()), { what: 'expired message' });
      assert(!hasSession(), 'stale reset session ended');
    }],
    ['cancelling the form ends the reset session and returns to sign-in', async () => {
      resetLinkOpened();
      await open('/auth?mode=update');
      $('cancelReset').click();
      await waitFor(() => at() === '/auth' && title() === 'Welcome back', { what: 'sign-in' });
      assert(!hasSession(), 'session ended');
    }],
    ['expired, used or invalid links show our own words (never text from the link), and redirects stay on this site', async () => {
      knobs({ signedOut: true, recovery: false });
      await open('/auth/callback?error=access_denied&error_code=otp_expired&error_description=Call+0800+to+fix+your+account');
      await waitFor(() => /expired or was already used/i.test($('cbText')?.textContent || ''), { what: 'expired message' });
      assert(!/0800/.test(d().body.textContent), 'link text not shown');
      await open('/auth/callback?code=used-or-invalid');
      await waitFor(() => /didn.t work/i.test($('cbTitle')?.textContent || ''), { what: 'invalid link message' });
      sessionStorage.removeItem('__signedOut'); knobs({ signedOut: false, recovery: false });
      localStorage.setItem(TOKEN, JSON.stringify({ access_token: 'fake.jwt.token', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: '11111111-1111-4111-8111-111111111111', email: 'tester@example.com', user_metadata: { age_13_plus_confirmed_at: 'x', terms_accepted_at: 'x' }, app_metadata: {} } }));
      await open('/auth/callback?next=%2F%2Fevil.example%2Fsteal');
      await waitFor(() => { const a = at(); return a !== '/auth/callback?next=%2F%2Fevil.example%2Fsteal' && a !== ''; }, { what: 'redirected' });
      eq(w().location.host, location.host, 'stayed on this site');
    }],
    // ---- links in our own emails: /auth/callback?token_hash=…&type=… (docs/launch/email-templates) ----
    // Reset links in our emails: Supabase turns a token_hash link into an "otp" session (not "recovery"), which the app
    // could not tell from a normal sign-in. So the link never becomes a session here: the form opens with the token kept
    // in this tab, and the token is used once, with the new password, in a separate in-memory client.
    ['opening a reset link signs NO ONE in: straight to the form, nothing verified, nothing stored, the app stays closed', async () => {
      signedOutBrowser();
      await open('/auth/callback#token_hash=pkce_qarec00001&type=recovery');
      await waitFor(() => at() === '/auth?mode=update' && title() === 'Choose a new password', { what: 'the new-password form', timeout: 8000 });
      eq(verifies().length, 0, 'nothing verified on opening (a mail scanner opening the link changes nothing)');
      assert(!hasSession(), 'no session in this browser');
      assert(!w().location.href.includes('pkce_qarec00001'), 'token not in the address');
      assert(!$('accountSlot').children.length, 'no account menu');
      await open('/library');
      await waitFor(() => at().startsWith('/auth?next=%2Flibrary'), { what: 'the app still asks to sign in' });
    }],
    ['saving the new password uses the link once, signs the account out everywhere, and asks to sign in', async () => {
      signedOutBrowser();
      sessionStorage.removeItem('__qaLogouts');
      await open('/auth/callback#token_hash=pkce_qarec00002&type=recovery');
      await waitFor(() => title() === 'Choose a new password', { what: 'form', timeout: 8000 });
      fill('link-new-pass-7');
      await waitFor(() => /Password updated. Sign in with your new password./.test(msg()), { what: 'confirmation', timeout: 8000 });
      eq(JSON.stringify(verifies().slice(-1)), JSON.stringify([{ type: 'recovery', hash: 'pkce_qarec00002' }]), 'verified once, as a reset');
      eq(sessionStorage.getItem('__qaPassword'), 'link-new-pass-7', 'password saved');
      eq(sessionStorage.getItem('__qaPasswordViaLink'), '1', 'by the link’s own in-memory session');
      assert(logouts().includes('global'), `signed out everywhere (${logouts()})`);
      assert(!hasSession(), 'nobody signed in here');
      eq(at(), '/auth', 'sign-in page');
      eq($('email').value, 'tester@example.com', 'email filled in');
    }],
    ['the same link again, or a bad one, says it expired or was used and offers a new link', async () => {
      signedOutBrowser();
      await open('/auth/callback#token_hash=pkce_qarec00002&type=recovery');
      await waitFor(() => title() === 'Choose a new password', { what: 'form', timeout: 8000 });
      fill('another-pass-8');
      await waitFor(() => /expired or was already used/i.test(msg()), { what: 'used link' });
      eq(title(), 'Reset your password', 'offers a new link');
      assert(!hasSession(), 'still nobody signed in');
      await open('/auth/callback#token_hash=bad%3Cscript%3E&type=recovery');
      await waitFor(() => /didn.t work/i.test($('cbTitle')?.textContent || ''), { what: 'malformed token refused' });
      await open('/auth/callback#token_hash=x&type=not-a-type');
      await waitFor(() => /didn.t work/i.test($('cbTitle')?.textContent || ''), { what: 'unknown type refused' });
    }],
    ['a refused password (too weak) can be fixed on the same page without a new link', async () => {
      signedOutBrowser();
      knobs({ weakPassword: true }); sessionStorage.removeItem('__qaWeakSeen');
      const n0 = verifies().length;
      await open('/auth/callback#token_hash=pkce_qarec00003&type=recovery');
      await waitFor(() => title() === 'Choose a new password', { what: 'form', timeout: 8000 });
      fill('password1');
      await waitFor(() => /stronger password/i.test(msg()), { what: 'weak refused' });
      eq(title(), 'Choose a new password', 'form stays');
      fill('a-much-better-pass-9');
      await waitFor(() => /Password updated./.test(msg()), { what: 'saved on the second try', timeout: 8000 });
      eq(verifies().length, n0 + 1, 'the link was used once');
      knobs({ weakPassword: false });
    }],
    ['a reset that is abandoned after the link was used leaves nothing: no stored session, and leaving ends it on the server', async () => {
      signedOutBrowser();
      knobs({ weakPassword: true }); sessionStorage.removeItem('__qaWeakSeen'); sessionStorage.removeItem('__qaLogouts');
      await open('/auth/callback#token_hash=pkce_qarec00007&type=recovery');
      await waitFor(() => title() === 'Choose a new password', { what: 'form', timeout: 8000 });
      fill('password1');
      await waitFor(() => /stronger password/i.test(msg()), { what: 'refused (the link is now used, its session in memory)' });
      assert(!Object.keys(localStorage).some((k) => /^sb-/.test(k)) && !Object.keys(sessionStorage).some((k) => /^sb-/.test(k)), 'no session stored anywhere');
      await open('/qa/e2e/host.html'); // the person leaves the page
      await waitFor(() => logouts().includes('local'), { what: 'that session ended on leaving' });
      knobs({ weakPassword: false });
    }],
    ['refreshing the form before saving keeps it working; an hour-old link is refused before any typing', async () => {
      signedOutBrowser();
      await open('/auth/callback#token_hash=pkce_qarec00004&type=recovery');
      await waitFor(() => title() === 'Choose a new password', { what: 'form', timeout: 8000 });
      w().location.reload();
      await sleep(1200);
      await waitFor(() => title() === 'Choose a new password', { what: 'form after refresh' });
      // an old link (kept more than an hour ago in this tab)
      sessionStorage.setItem('sparkscribe.resetLink', JSON.stringify({ hash: 'pkce_qarec00005', at: Date.now() - 2 * 3600 * 1000 }));
      await open('/auth?mode=update');
      await waitFor(() => /expired or was already used/i.test(msg()), { what: 'old link refused' });
    }],
    ['a reset link opened while another account is signed in: that account isn\'t used or shown; afterwards, sign in again', async () => {
      resetLinkOpened(); knobs({ recovery: false });
      localStorage.setItem(TOKEN, JSON.stringify({ access_token: 'fake.jwt.token', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: '33333333-3333-4333-8333-333333333333', email: 'other@example.com', user_metadata: {}, app_metadata: {} } }));
      knobs({ verifyEmail: 'tester@example.com' });
      await open('/auth/callback#token_hash=pkce_qarec00006&type=recovery');
      await waitFor(() => title() === 'Choose a new password', { what: 'form', timeout: 8000 });
      assert(!$('accountSlot').children.length, 'the other account is not shown');
      fill('third-new-pass-1');
      await waitFor(() => /Password updated./.test(msg()), { what: 'saved', timeout: 8000 });
      assert(!hasSession(), 'this browser signed out: the sign-in page comes next');
      knobs({ verifyEmail: null });
    }],
    ['an email verification link confirms the address, leaves nobody signed in, and asks to sign in (email filled in)', async () => {
      signedOutBrowser();
      knobs({ verifyEmail: 'new.person@example.com', verifyUserId: '22222222-2222-4222-8222-222222222222' });
      const n0 = verifies().length;
      await open('/auth/callback#token_hash=qa-sig-1&type=signup&next=%2Flibrary');
      await waitFor(() => $('cbGo')?.textContent === 'Verify email address', { what: 'verify page' });
      eq($('cbTitle').textContent, 'Verify your email address', 'title');
      await sleep(300);
      eq(verifies().length, n0, 'nothing verified on opening');
      $('cbGo').click();
      await waitFor(() => at().startsWith('/auth') && /Email verified. Sign in to get started/.test(msg()), { what: 'verified, asked to sign in', timeout: 8000 });
      eq(at(), '/auth?next=%2Flibrary', 'address cleaned, still returns to the page asked for');
      eq($('email').value, 'new.person@example.com', 'email filled in');
      assert(!hasSession(), 'not signed in by the link');
      assert(logouts().includes('local'), 'the session the confirmation created was ended');
    }],
    ['…a verification link opened while another account is signed in leaves that account alone', async () => {
      resetLinkOpened(); knobs({ recovery: false });
      localStorage.setItem(TOKEN, JSON.stringify({ access_token: 'fake.jwt.token', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: '11111111-1111-4111-8111-111111111111', email: 'tester@example.com', user_metadata: {}, app_metadata: {} } }));
      await open('/auth/callback?token_hash=qa-sig-3&type=signup');
      await waitFor(() => !$('cbGo').classList.contains('hidden'), { what: 'button' });
      $('cbGo').click();
      await waitFor(() => $('cbTitle')?.textContent === 'Email verified', { what: 'verified message' });
      assert(/signed in here as tester@example\.com/.test($('cbText').textContent), $('cbText').textContent);
      assert(JSON.parse(localStorage.getItem(TOKEN) || 'null')?.user?.email === 'tester@example.com', 'the signed-in account is unchanged');
      knobs({ verifyEmail: null, verifyUserId: null });
    }],
    ['a sign-up link through Supabase’s own address (?code=, flow=signup) also ends with "please sign in"; a foreign next is ignored', async () => {
      resetLinkOpened(); knobs({ recovery: false });
      localStorage.setItem(TOKEN, JSON.stringify({ access_token: 'fake.jwt.token', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: '11111111-1111-4111-8111-111111111111', email: 'tester@example.com', user_metadata: {}, app_metadata: {} } }));
      await open('/auth/callback?next=%2F%2Fevil.example%2Fx&flow=signup');
      await waitFor(() => /Email verified. Sign in to get started/.test(msg()), { what: 'asked to sign in', timeout: 8000 });
      eq(w().location.host, location.host, 'stayed on this site');
      assert(!hasSession(), 'signed out after confirming');
    }],
    ['the first half of an email change says to open the other link', async () => {
      signedOutBrowser();
      await open('/auth/callback?token_hash=qa-half-1&type=email_change');
      await waitFor(() => !$('cbGo').classList.contains('hidden'), { what: 'button' });
      $('cbGo').click();
      await waitFor(() => $('cbTitle')?.textContent === 'Almost done', { what: 'almost done' });
    }],
  ]);
  frame?.remove();
  knobs({ recovery: false, signedOut: false, samePassword: false });
  sessionStorage.removeItem('__signedOut');
  sessionStorage.removeItem('__qaPassword');
  return res;
}
