// Library deletes and "recently opened" (src/lib/library.js): deleteTranscripts, markOpened and deleteFolder.
// Supabase is "configured" with a made-up address through a Node module hook, and global fetch is the database stand-in,
// so every request is recorded here and nothing leaves this machine.
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
let reply = () => ({ status: 200, body: [] });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  let body = null;
  try { body = init.body ? JSON.parse(init.body) : null; } catch { body = init.body; }
  sent.push({ method: init.method || 'GET', path: u.pathname, query: u.searchParams, body, headers: new Headers(init.headers) });
  const { status, body: out } = reply();
  return new Response(JSON.stringify(out), { status, headers: { 'content-type': 'application/json' } });
};
const L = await import(new URL('../src/lib/library.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const last = () => sent.at(-1);
const fail = async (p) => { try { await p; } catch (e) { return e; } return null; };

// ---- deleteTranscripts
reply = () => ({ status: 200, body: [{ id: 't1' }, { id: 't2' }] });
ok((await L.deleteTranscripts(['t1', 't2', 't3'])) === 2, 'deleteTranscripts returns how many rows were actually deleted');
ok(last().method === 'DELETE' && last().query.get('id') === 'in.(t1,t2,t3)', 'it deletes exactly the ids asked for');
reply = () => ({ status: 200, body: [{ id: 't9' }] });
ok((await L.deleteTranscripts('t9')) === 1 && last().query.get('id') === 'in.(t9)', 'a single id is accepted without a list');
reply = () => ({ status: 200, body: [] });
ok((await L.deleteTranscripts(['gone'])) === 0, 'ids that no longer exist count as 0 deleted');
reply = () => ({ status: 403, body: { code: '42501', message: 'denied' } });
ok((await fail(L.deleteTranscripts(['t1'])))?.message === 'denied', 'a database error is thrown to the caller');

// ---- markOpened
reply = () => ({ status: 200, body: [] });
const n = sent.length;
const r = L.markOpened('t1');
ok(r === undefined, 'markOpened does not return a promise: opening a recording never waits for it');
await new Promise((res) => setTimeout(res, 20));
ok(sent.length === n + 1 && last().method === 'PATCH' && last().query.get('id') === 'eq.t1', 'it records the open on that recording');
ok(!Number.isNaN(Date.parse(last().body.last_opened_at)) && Math.abs(Date.now() - Date.parse(last().body.last_opened_at)) < 5000, 'with the current time as an ISO date');
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new TypeError('offline'); };
let threw = false;
try { L.markOpened('t1'); await new Promise((res) => setTimeout(res, 20)); } catch { threw = true; }
ok(!threw, 'a network failure is swallowed: it must never block opening a recording');
globalThis.fetch = realFetch;

// ---- deleteFolder
reply = () => ({ status: 200, body: [] });
await L.deleteFolder('f1');
ok(last().method === 'DELETE' && last().path === '/rest/v1/folders' && last().query.get('id') === 'eq.f1', 'deleteFolder deletes only the folder row (recordings are never touched)');
ok(!sent.some((s) => s.path === '/rest/v1/transcriptions' && s.method === 'DELETE' && s.query.get('id') === 'eq.f1'), 'no recording is deleted along with a folder');
reply = () => ({ status: 400, body: { code: 'x', message: 'nope' } });
ok((await fail(L.deleteFolder('f1')))?.message === 'nope', 'a database error is thrown to the caller');

console.log(`\n${pass} checks passed`);
