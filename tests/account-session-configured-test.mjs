// Sign-in state with accounts on (src/lib/account.js: getSession, getUser, requireUser).
// Supabase is "configured" with a made-up address through a Node module hook; fetch is the auth-server stand-in and
// location a recorder, so nothing leaves this machine. A stored session is put in localStorage the way Supabase keeps it.
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
const moves = [];
globalThis.location = { pathname: '/library', search: '?view=all', hash: '', replace: (u) => moves.push(u) };
const stored = new Map();
globalThis.localStorage = new Proxy({}, {
  get(_, k) { if (k === 'getItem') return (key) => stored.get(key) ?? null; if (k === 'setItem') return (key, v) => stored.set(key, String(v)); if (k === 'removeItem') return (key) => stored.delete(key); return undefined; },
  ownKeys() { return [...stored.keys()]; },
  getOwnPropertyDescriptor(_, k) { return stored.has(k) ? { enumerable: true, configurable: true, value: stored.get(k) } : undefined; },
});

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
const jwt = () => `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', aud: 'authenticated', exp: now() + 3600, amr: [{ method: 'password' }] })}.sig`;
let meta = {};
const userOf = () => ({ id: 'u1', aud: 'authenticated', email: 'a@example.com', app_metadata: {}, user_metadata: meta, created_at: '2026-01-01T00:00:00Z' });
let userReply = () => ({ status: 200, body: userOf() });
const seen = [];
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  seen.push(u.pathname);
  if (u.pathname === '/auth/v1/user') { const r = userReply(); return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } }); }
  return new Response(null, { status: 204 });
};
const A = await import(new URL('../src/lib/account.js', import.meta.url).href);
const { supabase } = await import(new URL('../src/lib/supabase.js', import.meta.url).href);
const setSession = async () => { const { error } = await supabase.auth.setSession({ access_token: jwt(), refresh_token: 'r' }); if (error) throw error; };

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const pending = (p) => Promise.race([p.then(() => 'resolved'), new Promise((res) => setTimeout(() => res('pending'), 60))]);

// ---- signed out
ok((await A.getSession()) === null && (await A.getUser()) === null, 'with no stored session, nobody is signed in');
ok(!seen.includes('/auth/v1/user'), '…and the auth server is not asked about a user it has never seen');
ok(await pending(A.requireUser()) === 'pending' && moves.at(-1) === `/auth?next=${encodeURIComponent('/library?view=all')}`, 'requireUser sends a signed-out visitor to /auth and stops the page');

// ---- signed in
await setSession();
ok((await A.getSession())?.user.id === 'u1', 'getSession returns the session kept in this browser');
seen.length = 0;
ok((await A.getUser())?.email === 'a@example.com' && seen.includes('/auth/v1/user'), 'getUser checks the person with the auth server');

// ---- the server rejects the stored session
userReply = () => ({ status: 401, body: { message: 'invalid JWT', code: 'bad_jwt' } });
seen.length = 0;
ok((await A.getUser()) === null, 'a stored session the server rejects reads as signed out');
ok((await A.getSession()) === null, '…and it is cleared from this browser, so the sign-in page cannot bounce back in a loop');

// ---- consent
userReply = () => ({ status: 200, body: userOf() });
await setSession();
meta = {};
moves.length = 0;
ok(await pending(A.requireUser()) === 'pending' && moves[0] === `/auth?mode=consent&next=${encodeURIComponent('/library?view=all')}`, 'a signed-in account without the confirmations is sent to the consent step');
meta = { terms_accepted_at: '2026-01-01', age_13_plus_confirmed_at: '2026-01-01' };
await setSession();
moves.length = 0;
ok((await A.requireUser()).id === 'u1' && moves.length === 0, 'an account that has confirmed is let in and not redirected');
meta = {};
location.pathname = '/terms';
await setSession();
moves.length = 0;
ok((await A.requireUser()).id === 'u1' && moves.length === 0, 'the Terms page can be read before confirming');
location.pathname = '/privacy';
ok((await A.requireUser()).id === 'u1' && moves.length === 0, '…and so can the Privacy page');

console.log(`\n${pass} checks passed`);
process.exit(0);
