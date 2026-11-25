// Who is calling? (server/http.js: authenticate, deploymentOrigin). Supabase Auth is a stand-in: global fetch answers
// the /auth/v1/user request, so nothing leaves this machine and no real token is used.
import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'http://db.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
delete process.env.VERCEL;
delete process.env.SPARKSCRIBE_DEV_HARNESS;
const { authenticate, deploymentOrigin } = await import(new URL('../server/http.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const fail = async (p) => { try { await p; } catch (e) { return e; } return null; };

// ---- deploymentOrigin
ok(deploymentOrigin({}) === null, 'no Vercel variables: no origin');
ok(deploymentOrigin({ VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'www.spark-scribe.com', VERCEL_URL: 'x.vercel.app' }) === 'https://www.spark-scribe.com', 'production uses the production URL');
ok(deploymentOrigin({ VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: 'b.vercel.app', VERCEL_URL: 'u.vercel.app' }) === 'https://b.vercel.app', 'a preview prefers its branch URL');
ok(deploymentOrigin({ VERCEL_ENV: 'preview', VERCEL_URL: 'u.vercel.app' }) === 'https://u.vercel.app', 'a preview falls back to the deployment URL');
ok(deploymentOrigin({ VERCEL_ENV: 'production' }) === null, 'production without a production URL gives no origin');

// ---- authenticate
const seen = [];
let userReply = () => ({ status: 200, body: { id: 'user-1', aud: 'authenticated', email: 'a@b.c' } });
globalThis.fetch = async (url, init = {}) => {
  seen.push({ url: String(url), headers: new Headers(init.headers) });
  const { status, body } = userReply();
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
const req = (authorization) => ({ headers: authorization === undefined ? {} : { authorization } });

let e = await fail(authenticate(req()));
ok(e?.status === 401 && e.code === 'unauthorized' && seen.length === 0, 'no Authorization header: 401, and Supabase is never asked');
e = await fail(authenticate(req('Basic abc')));
ok(e?.status === 401 && seen.length === 0, 'a non-Bearer header is refused without a lookup');
e = await fail(authenticate(req('Bearer ')));
ok(e?.status === 401 && seen.length === 0, 'an empty Bearer token is refused without a lookup');

const good = jwt({ sub: 'user-1', amr: [{ method: 'password', timestamp: 100 }] });
const ctx = await authenticate(req(`Bearer ${good}`));
ok(ctx.user.id === 'user-1' && Object.keys(ctx.user).join() === 'id', 'a valid token gives only the user id');
ok(typeof ctx.db === 'object' && ctx.db !== null, 'and a store that queries as that user');
ok(seen.at(-1).url.includes('/auth/v1/user') && seen.at(-1).headers.get('authorization') === `Bearer ${good}`, 'the token is verified by Supabase Auth');

userReply = () => ({ status: 401, body: { msg: 'invalid JWT' } });
e = await fail(authenticate(req(`Bearer ${good}`)));
ok(e?.status === 401 && /expired/i.test(e.message), 'a token Supabase rejects reads as an expired session');

userReply = () => ({ status: 200, body: { id: 'user-1' } });
const recovery = jwt({ sub: 'user-1', amr: [{ method: 'password', timestamp: 1 }, { method: 'recovery', timestamp: 2 }] });
e = await fail(authenticate(req(`Bearer ${recovery}`)));
ok(e?.status === 403 && e.code === 'recovery_session', 'a password-reset session is not a sign-in (403 recovery_session)');
const afterReset = jwt({ sub: 'user-1', amr: [{ method: 'recovery', timestamp: 1 }, { method: 'password', timestamp: 2 }] });
ok((await authenticate(req(`Bearer ${afterReset}`))).user.id === 'user-1', 'once a newer password sign-in exists the session is accepted');

// ---- origin header
process.env.VERCEL_ENV = 'production';
process.env.VERCEL_PROJECT_PRODUCTION_URL = 'www.spark-scribe.com';
seen.length = 0;
const c2 = await authenticate(req(`Bearer ${good}`));
ok(c2.user.id === 'user-1' && seen[0].headers.get('x-sparkscribe-origin') === 'https://www.spark-scribe.com', 'the deployment origin is sent with the lookup');
delete process.env.VERCEL_ENV;
delete process.env.VERCEL_PROJECT_PRODUCTION_URL;

// ---- not configured
delete process.env.SUPABASE_URL;
seen.length = 0;
e = await fail(authenticate(req(`Bearer ${good}`)));
ok(e?.status === 503 && e.code === 'not_configured' && seen.length === 0, 'without Supabase settings: 503 not_configured, no lookup');

// ---- dev harness is never honoured on Vercel or without the opt-in
process.env.SUPABASE_URL = 'http://db.invalid';
globalThis.__sparkscribeDevHarness = { context: () => ({ user: { id: 'harness' }, db: {} }) };
const hreq = { headers: { 'x-dev-harness': '1', authorization: `Bearer ${good}` } };
ok((await authenticate(hreq)).user.id === 'user-1', 'the dev harness is ignored unless explicitly enabled');
process.env.SPARKSCRIBE_DEV_HARNESS = '1';
ok((await authenticate(hreq)).user.id === 'harness', 'enabled locally, the harness answers');
process.env.VERCEL = '1';
ok((await authenticate(hreq)).user.id === 'user-1', 'on Vercel the harness is never used, even when enabled');

console.log(`${pass} checks passed`);
