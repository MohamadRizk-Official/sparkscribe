// Account actions (src/lib/account.js): deleting an account, signing out, forgetting this browser, consent and email change.
// Supabase is "configured" with a made-up address through a Node module hook; fetch is the stand-in for Supabase Auth and
// for /api/billing, and localStorage/sessionStorage are plain objects, so nothing leaves this machine.
import assert from 'node:assert/strict';
import { register } from 'node:module';
const hook = `export async function load(url, context, nextLoad) {
  const r = await nextLoad(url, context);
  if (url.includes('/src/') && r.format === 'module' && r.source) {
    const env = '({NEXT_PUBLIC_SUPABASE_URL:"http://db.invalid",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_test"})';
    return { ...r, source: String(r.source).replace(/import\\.meta\\.env/g, env) };
  }
  return r;
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

// storage: own keys are the stored items, so Object.keys() lists them like the real thing
const makeStorage = () => new Proxy({}, {
  get(t, k) {
    if (k === 'getItem') return (key) => (key in t ? t[key] : null);
    if (k === 'setItem') return (key, v) => { t[key] = String(v); };
    if (k === 'removeItem') return (key) => { delete t[key]; };
    return t[k];
  },
});
globalThis.localStorage = makeStorage();
globalThis.sessionStorage = makeStorage();
globalThis.indexedDB = undefined;
const placed = [];
globalThis.location = { pathname: '/library', search: '', replace: (u) => placed.push(u), assign: (u) => placed.push(u) };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (extra = {}) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, ...extra })}.sig`;
const USER = { id: 'u1', aud: 'authenticated', email: 'ann@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const sent = [];
let routes = {};
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://app.invalid');
  const key = u.pathname;
  let body = null;
  try { body = init.body ? JSON.parse(init.body) : null; } catch { body = null; }
  sent.push({ path: key, method: init.method || 'GET', body });
  const r = (routes[key] || (() => ({ status: 200, body: {} })))(body);
  return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
};
const A = await import(new URL('../src/lib/account.js', import.meta.url).href);
const { supabase } = await import(new URL('../src/lib/supabase.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const fail = async (p) => { try { await p; } catch (e) { return e; } return null; };
const deleteCalls = () => sent.filter((s) => s.path === '/api/billing');

routes['/auth/v1/user'] = () => ({ status: 200, body: USER });
await supabase.auth.setSession({ access_token: jwt(), refresh_token: 'r' });
sent.length = 0;

// ---- consent
ok(A.hasConsent({ user_metadata: { terms_accepted_at: 'a', age_13_plus_confirmed_at: 'b' } }) === true, 'consent needs both the Terms and the 13+ confirmation');
ok(!A.hasConsent({ user_metadata: { terms_accepted_at: 'a' } }) && !A.hasConsent(null) && !A.hasConsent({}), 'one of them, or none, is not consent');
ok(A.consentUrl('/library?x=1') === '/auth?mode=consent&next=%2Flibrary%3Fx%3D1', 'consentUrl sends people back where they were, encoded');
ok(A.consentUrl() === '/auth?mode=consent&next=%2Flibrary', 'by default it returns to the current page');
routes['/auth/v1/user'] = (b) => ({ status: 200, body: { ...USER, user_metadata: b?.data || {}, new_email: b?.email } });
const consented = await A.recordConsent();
const put = sent.find((s) => s.path === '/auth/v1/user' && s.method === 'PUT');
ok(put.body.data.terms_accepted_at && put.body.data.terms_accepted_at === put.body.data.age_13_plus_confirmed_at, 'recordConsent stores both confirmations with the same time');
ok(!Number.isNaN(Date.parse(put.body.data.terms_accepted_at)) && A.hasConsent(consented), 'the time is real, and the returned user now has consent');
routes['/auth/v1/user'] = () => ({ status: 422, body: { code: 'x', msg: 'nope', message: 'nope' } });
ok((await fail(A.recordConsent())) !== null, 'a failed save is thrown, not hidden');

// ---- changeEmail
routes['/auth/v1/user'] = (b) => ({ status: 200, body: { ...USER, new_email: b?.email } });
const ch = await A.changeEmail('new@example.com');
ok(ch.error === null && ch.user.new_email === 'new@example.com', 'changeEmail asks for the change and returns the user');
routes['/auth/v1/user'] = () => ({ status: 422, body: { code: 'email_exists', msg: 'taken', message: 'taken' } });
const ch2 = await A.changeEmail('taken@example.com');
ok(ch2.user === null && ch2.error, 'a refused change returns the error and no user (it does not throw)');

// ---- forgetThisBrowser
localStorage.setItem('sparkscribe.theme', 'dark');
localStorage.setItem('sparkscribe.modelsCached', '1');
localStorage.setItem('sparkscribe.mascot', 'quiet');
localStorage.setItem('sparkscribe.pendingSave', '{}');
localStorage.setItem('other.site', 'keep');
sessionStorage.setItem('sparkscribe.tab', 'x');
sessionStorage.setItem('unrelated', 'y');
A.forgetThisBrowser();
ok(localStorage.getItem('sparkscribe.theme') === 'dark' && localStorage.getItem('sparkscribe.modelsCached') === '1', 'the theme and the downloaded-models flag stay on the device');
ok(localStorage.getItem('sparkscribe.mascot') === null && localStorage.getItem('sparkscribe.pendingSave') === null, 'every other SparkScribe setting is removed');
ok(localStorage.getItem('other.site') === 'keep' && sessionStorage.getItem('unrelated') === 'y', 'things that are not SparkScribe\'s are left alone');
ok(sessionStorage.getItem('sparkscribe.tab') === null, 'tab storage for SparkScribe is cleared too');

// ---- deleteMyAccount
routes = {};
routes['/auth/v1/user'] = () => ({ status: 200, body: USER });
routes['/auth/v1/token'] = () => ({ status: 400, body: { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', message: 'Invalid login credentials' } });
sent.length = 0;
let e = await fail(A.deleteMyAccount('pw', 'cap'));
// the signed-in session exists, so the first call is the password check
ok(sent[0].path === '/auth/v1/token' && sent[0].body.email === 'ann@example.com' && sent[0].body.password === 'pw', 'the password is checked by signing in again with the session\'s email');
ok(e instanceof Error && sent[0].body.gotrue_meta_security?.captcha_token === 'cap', 'the security-check token is passed along with the password');
ok(deleteCalls().length === 0, 'and nothing is sent to the server to delete');

e = await fail(A.deleteMyAccount('wrong'));
ok(e?.message === 'That password isn’t right.', 'a wrong password reads "That password isn’t right."');
routes['/auth/v1/token'] = () => ({ status: 400, body: { code: 'captcha_failed', message: 'captcha verification process failed' } });
e = await fail(A.deleteMyAccount('pw'));
ok(/security check/.test(e?.message) && /nothing was deleted/.test(e.message), 'a failed security check says nothing was deleted');
ok(deleteCalls().length === 0, 'neither failure reached the server');

routes['/auth/v1/token'] = () => ({ status: 200, body: { access_token: jwt(), refresh_token: 'r2', token_type: 'bearer', expires_in: 3600, user: USER } });
const reasons = (body, status = 200) => { routes['/api/billing'] = () => ({ status, body }); };
reasons({ deleted: false, reason: 'subscription' });
e = await fail(A.deleteMyAccount('pw'));
ok(/paid plan that is still active/.test(e?.message), 'an active paid plan must be cancelled first');
reasons({ deleted: false, reason: 'recent_login' });
e = await fail(A.deleteMyAccount('pw'));
ok(e?.message === 'Please enter your password again.', 'with a password, a refusal asks for it again');
reasons({ deleted: false });
const tokenCalls = () => sent.filter((s) => s.path === '/auth/v1/token').length;
const t0 = tokenCalls();
e = await fail(A.deleteMyAccount(null));
ok(/sign out and sign in again/.test(e?.message) && /10 minutes/.test(e.message), 'with no password (null), a refusal asks for a fresh sign-in');
ok(tokenCalls() === t0, 'a null password skips the password check');
reasons({ error: 'deletion_failed', message: 'The database said no.' }, 500);
e = await fail(A.deleteMyAccount('pw'));
ok(e?.message === 'The database said no.', 'known server failures show the server\'s own message');
reasons({ error: 'weird', message: 'internal detail' }, 500);
e = await fail(A.deleteMyAccount('pw'));
ok(e?.message === 'Your account couldn’t be deleted, and nothing was removed. Try again.' && !/internal/.test(e.message), 'unknown failures never leak details');

// success: this browser is cleaned and the local session dropped
localStorage.setItem('sparkscribe.mascot', 'on');
reasons({ deleted: true });
const sentBefore = sent.length;
const done = await A.deleteMyAccount('pw');
ok(done === undefined && localStorage.getItem('sparkscribe.mascot') === null, 'after a successful deletion this browser is cleaned');
ok(sent.slice(sentBefore).some((s) => s.path === '/api/billing' && s.body.action === 'delete_account' && s.body.confirm === 'DELETE'), 'the server was asked to delete, with the confirmation word');

// ---- signed out: nothing to delete
await supabase.auth.signOut({ scope: 'local' });
e = await fail(A.deleteMyAccount('pw'));
ok(/Sign in again/.test(e?.message), 'with no session, deletion asks to sign in first');

// ---- signOut clears parked data
localStorage.setItem('sparkscribe.pendingSave', '{"t":1}');
localStorage.setItem('sparkscribe.across.abc', 'old answer');
localStorage.setItem('sparkscribe.mascot', 'on');
await A.signOut();
ok(localStorage.getItem('sparkscribe.pendingSave') === null && localStorage.getItem('sparkscribe.across.abc') === null, 'signOut removes a transcript parked for sign-in and old Across answers');
ok(localStorage.getItem('sparkscribe.mascot') === 'on', 'but keeps ordinary preferences');

console.log(`${pass} checks passed`);
