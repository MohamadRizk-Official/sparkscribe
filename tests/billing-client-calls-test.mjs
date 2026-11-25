// Billing calls from the browser (src/lib/billing.js): what is sent to /api/billing, how errors read, and the plan helpers.
// Supabase is "configured" with a made-up address through a Node module hook; the stored session is in a fake localStorage,
// and global fetch is the server stand-in, so nothing leaves this machine.
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


const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
// outside a browser the client keeps its session in memory, so the session is handed to it directly (its user lookup goes to the stand-in)
const signIn = async () => (await import(new URL('../src/lib/supabase.js', import.meta.url).href)).supabase.auth.setSession({ access_token: TOKEN, refresh_token: 'r' });

const sent = [];
let reply = () => ({ status: 200, body: { id: 'u1', aud: 'authenticated', email: 'a@b.c', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
globalThis.fetch = async (url, init = {}) => {
  sent.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
  const r = reply();
  if (r.throws) throw new TypeError('network down');
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
};
const assigned = [];
globalThis.location = { assign: (u) => assigned.push(u) };
const Bill = await import(new URL('../src/lib/billing.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const fail = async (p) => { try { await p; } catch (e) { return e; } return null; };

let e;
// ---- signed in
await signIn();
sent.length = 0;
reply = () => ({ status: 200, body: { plan: 'bolt', planName: 'Bolt', features: ['across'] } });
const st = await Bill.getBillingStatus();
ok(st.plan === 'bolt' && sent[0].url === '/api/billing' && sent[0].init.method === 'POST', 'status is a POST to /api/billing');
ok(sent[0].init.headers.authorization === `Bearer ${TOKEN}` && sent[0].init.headers['content-type'] === 'application/json', 'it carries the access token');
ok(JSON.stringify(sent[0].body) === '{"action":"status"}', 'a plain status request sends only the action');
await Bill.getBillingStatus({ detail: true });
ok(sent.at(-1).body.detail === true, 'getBillingStatus({ detail: true }) asks for the detail');
await Bill.authorizeTranscription(125);
ok(sent.at(-1).body.action === 'authorize' && sent.at(-1).body.durationSeconds === 125, 'authorizeTranscription sends the length in seconds');
await Bill.deleteAccountOnServer();
ok(sent.at(-1).body.action === 'delete_account' && sent.at(-1).body.confirm === 'DELETE', 'account deletion sends the confirmation word');

// ---- checkout and portal redirect
reply = () => ({ status: 200, body: { url: 'https://checkout.example/s/1' } });
const co = await Bill.startCheckout('flash');
ok(sent.at(-1).body.plan === 'flash' && sent.at(-1).body.interval === 'month', 'checkout defaults to the monthly interval');
ok(assigned.at(-1) === 'https://checkout.example/s/1' && co.url === assigned.at(-1), 'and sends the browser to the address the server returned');
await Bill.startCheckout('bolt', 'year');
ok(sent.at(-1).body.interval === 'year', 'a yearly interval is passed on');
reply = () => ({ status: 200, body: { url: 'https://portal.example/p' } });
await Bill.openPortal();
ok(sent.at(-1).body.action === 'portal' && assigned.at(-1) === 'https://portal.example/p', 'the portal opens at the returned address');

// ---- errors
reply = () => ({ status: 402, body: { error: 'quota', message: 'Out of minutes.', resetAt: '2026-12-01' } });
e = await fail(Bill.authorizeTranscription(60));
ok(e.status === 402 && e.code === 'quota' && e.message === 'Out of minutes.' && e.resetAt === '2026-12-01', 'a server error keeps its message, code, status and extra fields');
reply = () => ({ status: 500, body: {} });
e = await fail(Bill.authorizeTranscription(60));
ok(e.message === 'Something went wrong. Try again.' && e.code === 'error' && e.status === 500, 'an error with no body gets a generic message');
reply = () => ({ throws: true });
e = await fail(Bill.authorizeTranscription(60));
ok(e.code === 'network' && e.status === 0 && /connection/.test(e.message), 'a dropped connection reads as a network error');
const before = assigned.length;
reply = () => ({ status: 503, body: { error: 'payments_unavailable', message: 'Not yet.' } });
e = await fail(Bill.startCheckout('flash'));
ok(e.code === 'payments_unavailable' && assigned.length === before, 'a refused checkout never redirects');

// ---- myPlan is cached, and a failure is not
reply = () => ({ status: 503, body: { error: 'x' } });
ok((await Bill.myPlan()) === null, 'myPlan is null when the status cannot be read');
reply = () => ({ status: 200, body: { plan: 'free', planName: 'Free', features: 'oops' } });
const plan = await Bill.myPlan();
ok(plan.plan === 'free' && Array.isArray(plan.features) && plan.features.length === 0, 'after a failure it asks again; odd features become an empty list');
const n = sent.length;
await Bill.myPlan();
ok(sent.length === n, 'a good answer is cached for the page');

// ---- signed out (a local sign-out clears the session the client holds)
reply = () => ({ status: 200, body: {} });
await (await import(new URL('../src/lib/supabase.js', import.meta.url).href)).supabase.auth.signOut({ scope: 'local' });
sent.length = 0;
e = await fail(Bill.getBillingStatus());
ok(e instanceof Bill.BillingApiError && e.status === 401 && e.code === 'unauthorized' && sent.length === 0, 'signed out: "Sign in to continue", and no request is made');


// ---- helpers
ok(Bill.can({ features: ['across'] }, 'across') && !Bill.can({ features: ['across'] }, 'focus') && !Bill.can(null, 'across') && !Bill.can({}, 'across'), 'can() is true only for a listed capability');
const lineup = [{ key: 'free', features: [] }, { key: 'flash', features: ['study'] }, { key: 'bolt', features: ['study', 'across'] }];
ok(Bill.planWith(lineup, 'study').key === 'flash' && Bill.planWith(lineup, 'across').key === 'bolt', 'planWith finds the lowest plan that includes a capability');
ok(Bill.planWith(lineup, 'nothing') === null, 'and null when none does');

console.log(`${pass} checks passed`);
