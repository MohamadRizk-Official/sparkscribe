// Password-reset sessions (src/lib/recovery.js): endSession and guardRecovery, the parts that act on a session.
// Supabase is "configured" with a made-up address through a Node module hook; fetch is the Supabase stand-in
// and location a recorder, so nothing leaves this machine.
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
globalThis.indexedDB = undefined;
const nav = [];
globalThis.location = { pathname: '/library', replace: (u) => nav.push(['replace', u]), reload: () => nav.push(['reload']) };
const stored = new Map([['sb-db-auth-token', '{"x":1}'], ['sparkscribe.mascot', 'on']]);
globalThis.localStorage = new Proxy({}, {
  get(_, k) { if (k === 'getItem') return (key) => stored.get(key) ?? null; if (k === 'setItem') return (key, v) => stored.set(key, v); if (k === 'removeItem') return (key) => stored.delete(key); return undefined; },
  ownKeys() { return [...stored.keys()]; },
  getOwnPropertyDescriptor(_, k) { return stored.has(k) ? { enumerable: true, configurable: true, value: stored.get(k) } : undefined; },
});

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (amr) => `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, amr })}.sig`;
const now = () => Math.floor(Date.now() / 1000);
let logout = () => ({ status: 204 });
const logoutScopes = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.pathname === '/auth/v1/logout') {
    logoutScopes.push(u.searchParams.get('scope'));
    const r = logout();
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ id: 'u1', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const R = await import(new URL('../src/lib/recovery.js', import.meta.url).href);
const { supabase } = await import(new URL('../src/lib/supabase.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const sessionWith = (amr) => ({ access_token: token(amr) });
const signInWith = async (amr) => { await supabase.auth.setSession({ access_token: token(amr), refresh_token: 'r' }); };

// ---- currentSession
ok((await R.currentSession()) === null, 'with nobody signed in there is no current session');
await signInWith([{ method: 'password', timestamp: now() }]);
ok((await R.currentSession()).access_token, 'a signed-in browser reports its session');

// ---- endSession
logoutScopes.length = 0;
ok((await R.endSession()) === 'local' && logoutScopes.join() === 'local', 'a plain end signs out this browser only');
await signInWith([{ method: 'password', timestamp: now() }]);
logoutScopes.length = 0;
ok((await R.endSession({ everywhere: true })) === 'global' && logoutScopes.join() === 'global', 'everywhere ends every session of the account');
await signInWith([{ method: 'password', timestamp: now() }]);
logoutScopes.length = 0;
logout = () => ({ status: 500, body: { message: 'down' } });
const r = await R.endSession({ everywhere: true });
ok(r === 'local' && logoutScopes[0] === 'global', 'if the global request fails, it falls back to signing out this browser');
ok((await R.currentSession()) === null, 'and this browser really is signed out');
// local sign-out that errors still clears the stored session
stored.set('sb-db-auth-token', '{"x":1}');
await signInWith([{ method: 'password', timestamp: now() }]);
stored.set('sb-db-auth-token', '{"x":1}');
stored.set('sparkscribe.mascot', 'on');
logout = () => ({ status: 500, body: { message: 'down' } });
await R.endSession();
ok(!stored.has('sb-db-auth-token') && stored.get('sparkscribe.mascot') === 'on', 'when even the local request errors, the stored session is removed from this browser, and nothing else');
logout = () => ({ status: 204 });

// ---- guardRecovery
nav.length = 0;
ok((await R.guardRecovery(null)) === false && nav.length === 0, 'no session: nothing to guard');
ok((await R.guardRecovery(sessionWith([{ method: 'password', timestamp: now() }]))) === false && nav.length === 0, 'an ordinary sign-in is left alone');
ok((await R.guardRecovery(sessionWith([{ method: 'recovery', timestamp: now() }]), '/auth')) === false && nav.length === 0, 'on the sign-in page a recovery session may stay (it sets the new password there)');
ok((await R.guardRecovery(sessionWith([{ method: 'recovery', timestamp: now() }]), '/auth/callback')) === false, 'and on pages under /auth');
ok((await R.guardRecovery(sessionWith([{ method: 'recovery', timestamp: now() }]), '/authors')) === true, '…but "/authors" is not an /auth page');
ok(nav.at(-1)[0] === 'replace' && nav.at(-1)[1] === '/auth?mode=update', 'a fresh recovery session elsewhere goes back to the new-password form');
nav.length = 0;
ok((await R.guardRecovery(sessionWith([{ method: 'recovery', timestamp: now() - 120 }]), '/library')) === true && nav.length === 1 && nav[0][1] === '/auth?mode=update', 'two minutes old is still fresh');
await signInWith([{ method: 'recovery', timestamp: now() - 3600 }]);
logoutScopes.length = 0;
nav.length = 0;
ok((await R.guardRecovery(sessionWith([{ method: 'recovery', timestamp: now() - 3600 }]), '/library')) === true, 'an hour-old recovery session is stopped');
ok(logoutScopes.join() === 'local' && nav.length === 1 && nav[0][0] === 'reload', 'it is signed out in this browser and the page reloads');
ok((await R.currentSession()) === null, 'so it cannot be used to get into the app');
nav.length = 0;
ok((await R.guardRecovery(sessionWith([{ method: 'recovery', timestamp: now() - 3600 }, { method: 'password', timestamp: now() }]), '/library')) === false && nav.length === 0, 'a recovery session followed by a normal sign-in is just a sign-in');
ok((await R.guardRecovery(sessionWith([{ method: 'recovery', timestamp: now() }]))) === true && nav.at(-1)[1] === '/auth?mode=update', 'the page defaults to the current location');

console.log(`${pass} checks passed`);
