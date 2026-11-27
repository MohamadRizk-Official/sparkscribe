// The browser's Supabase module when the site HAS settings (src/lib/supabase.js): the shared client, the keepalive
// logout, the cached sign-in settings and the in-memory isolated client. The address is made up and fetch is the
// stand-in that records every request, so nothing leaves this machine.
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
const sent = [];
let settingsReply = () => new Response(JSON.stringify({ external: { google: true }, disable_signup: false }), { status: 200, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  sent.push({ method: init.method || 'GET', path: u.pathname, query: u.searchParams, headers: new Headers(init.headers), keepalive: init.keepalive });
  if (u.pathname === '/auth/v1/settings') return settingsReply();
  return new Response(null, { status: 204 });
};
const S = await import(new URL('../src/lib/supabase.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

ok(S.isConfigured === true && S.supabaseUrl === 'http://db.invalid', 'with a URL and key the site is configured and exposes the URL');
ok(S.supabase && typeof S.supabase.auth.getSession === 'function' && typeof S.supabase.from === 'function', 'there is one shared client with auth and data access');

// ---- revokeSessionNow
S.revokeSessionNow('tok123');
const out = sent.at(-1);
ok(out.method === 'POST' && out.path === '/auth/v1/logout' && out.query.get('scope') === 'local', 'revoking sends POST /auth/v1/logout?scope=local (this session only)');
ok(out.headers.get('authorization') === 'Bearer tok123' && out.headers.get('apikey') === 'sb_publishable_test', 'it carries the session\'s own token and the public key');
ok(out.keepalive === true, 'it is a keepalive request, so it still goes out while the page is closing');
const n = sent.length;
S.revokeSessionNow('');
S.revokeSessionNow(null);
ok(sent.length === n, 'with no token nothing is sent');
const real = globalThis.fetch;
globalThis.fetch = () => { throw new Error('sync failure'); };
let threw = false;
try { S.revokeSessionNow('tok'); } catch { threw = true; }
ok(!threw, 'a failure to even start the request is swallowed');
globalThis.fetch = () => Promise.reject(new Error('offline'));
try { S.revokeSessionNow('tok'); await new Promise((r) => setTimeout(r, 10)); } catch { threw = true; }
ok(!threw, 'a rejected request is swallowed too');
globalThis.fetch = real;

// ---- authSettings
sent.length = 0;
const a = await S.authSettings();
ok(a?.external?.google === true, 'the sign-in settings come from the public settings endpoint');
ok(sent.length === 1 && sent[0].path === '/auth/v1/settings' && sent[0].headers.get('apikey') === 'sb_publishable_test' && !sent[0].headers.get('authorization'), 'the request carries only the public key');
await S.authSettings();
ok(sent.length === 1 && (await S.authSettings()) === a, 'the answer is fetched once and then shared');

// ---- isolatedClient
const iso = S.isolatedClient();
ok(iso && iso !== S.supabase, 'the isolated client is a separate client');
ok(S.isolatedClient() !== iso, 'each call makes a fresh one');
ok((await iso.auth.getSession()).data.session === null, 'it starts with no session, whoever is signed in here');

console.log(`\n${pass} checks passed`);
process.exit(0);
