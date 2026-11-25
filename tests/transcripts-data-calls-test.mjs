// Saved transcripts (src/lib/transcripts.js): the save/update/delete requests, retry safety, and the sign-in hand-off.
// Supabase is "configured" with a made-up address through a Node module hook; fetch is the database stand-in
// and localStorage a plain map, so nothing leaves this machine.
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
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const sent = [];
let replies = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  let body = null;
  try { body = init.body ? JSON.parse(init.body) : null; } catch { body = null; }
  sent.push({ method: init.method || 'GET', path: u.pathname, query: u.searchParams, body, headers: new Headers(init.headers) });
  const r = replies.length > 1 ? replies.shift() : replies[0];
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
};
const T = await import(new URL('../src/lib/transcripts.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const fail = async (p) => { try { await p; } catch (e) { return e; } return null; };
const reply = (...r) => { replies = r; sent.length = 0; };
const last = () => sent.at(-1);

// ---- saveTranscript without an id
reply({ status: 201, body: { id: 'new-1' } });
const id1 = await T.saveTranscript({ title: 'Week 1', durationSeconds: 61.6, language: 'en', text: 'hello', segments: [{ s: 0 }], recordingType: 'lecture' });
ok(id1 === 'new-1' && sent.length === 1 && last().method === 'POST' && last().path === '/rest/v1/transcriptions', 'a save inserts one row and returns its id');
const row = last().body;
ok(row.title === 'Week 1' && row.status === 'completed' && row.duration_seconds === 62 && row.language === 'en' && row.recording_type === 'lecture' && row.transcript_text === 'hello', 'the row carries title, status, rounded seconds, language, type and text');
ok(!('id' in row) && !('user_id' in row), 'no id is sent when none was chosen, and the user id is never sent from the browser');
reply({ status: 201, body: { id: 'n2' } });
await T.saveTranscript({ title: '', durationSeconds: NaN, text: 't' });
ok(last().body.title === 'Untitled transcript' && last().body.duration_seconds === null && last().body.language === null && last().body.recording_type === null && last().body.segments === null, 'blank title, unknown length, language, type and segments get safe defaults');
await T.saveTranscript({ title: 'x'.repeat(400), durationSeconds: 1, text: 't' });
ok(last().body.title.length === 300, 'long titles are cut to 300 characters');
reply({ status: 500, body: { code: 'XX000', message: 'boom' } });
ok((await fail(T.saveTranscript({ title: 't', text: 't' })))?.message === 'boom', 'a database error is thrown');

// ---- saveTranscript with an id (safe to retry)
reply({ status: 201, body: { id: 'chosen-1' } });
ok((await T.saveTranscript({ id: 'chosen-1', title: 't', text: 't' })) === 'chosen-1' && last().body.id === 'chosen-1', 'a page-chosen id is sent with the row');
reply({ status: 409, body: { code: '23505', message: 'duplicate key' } }, { status: 200, body: { id: 'chosen-1' } });
ok((await T.saveTranscript({ id: 'chosen-1', title: 't', text: 't' })) === 'chosen-1', 'a retry after a lost answer finds the earlier save and counts as saved');
ok(sent.length === 2 && sent[1].method === 'GET' && sent[1].query.get('id') === 'eq.chosen-1', 'it looks the id up instead of inserting a second copy');
reply({ status: 409, body: { code: '23505', message: 'duplicate key' } }, { status: 200, body: null });
ok((await fail(T.saveTranscript({ id: 'someone-elses', title: 't', text: 't' })))?.code === '23505', 'a duplicate id that is not yours is an error, not a success');
reply({ status: 403, body: { code: '42501', message: 'permission denied for table transcriptions' } }, { status: 201, body: { id: 'server-made' } });
const fb = await T.saveTranscript({ id: 'chosen-2', title: 't', text: 't' });
ok(fb === 'server-made' && sent.length === 2 && !('id' in sent[1].body), 'a database that refuses client ids is retried once without the id');
reply({ status: 400, body: { code: '22P02', message: 'bad input' } });
ok((await fail(T.saveTranscript({ id: 'chosen-3', title: 't', text: 't' })))?.code === '22P02' && sent.length === 1, 'any other error with an id is thrown without a second attempt');

// ---- updates
reply({ status: 200, body: [{ id: 'a' }] });
await T.updateTranscriptText('a', 'new text', null);
ok(last().method === 'PATCH' && last().query.get('id') === 'eq.a' && last().body.transcript_text === 'new text' && !('segments' in last().body), 'updating only text leaves segments out');
await T.updateTranscriptText('a', 'new text', [{ s: 1 }]);
ok(last().body.segments[0].s === 1, 'segments are sent when given');
reply({ status: 200, body: [] });
ok(/no longer exists/.test((await fail(T.updateTranscriptText('gone', 't', null)))?.message), 'updating a transcript that is gone says so');
reply({ status: 200, body: [] });
await T.updateRecordingType('a', 'meeting');
ok(last().body.recording_type === 'meeting' && last().query.get('id') === 'eq.a', 'updateRecordingType changes only the type');

// ---- reading and deleting
reply({ status: 200, body: [{ id: 'a' }, { id: 'b' }] });
ok((await T.listTranscripts()).length === 2 && last().query.get('limit') === '500' && last().query.get('order') === 'created_at.desc', 'the list is newest first, capped at 500');
ok(!last().query.get('select').includes('transcript_text'), 'and does not download every transcript\'s text');
reply({ status: 200, body: { id: 'a', transcript_text: 'x' } });
ok((await T.getTranscript('a')).id === 'a', 'getTranscript returns the row');
reply({ status: 200, body: null });
ok((await T.getTranscript('zzz')) === null, '…or null when it is missing or not yours');
reply({ status: 200, body: [{ id: 'a' }] });
await T.deleteTranscript('a');
ok(last().method === 'DELETE' && last().query.get('id') === 'eq.a', 'deleteTranscript removes that row');
reply({ status: 200, body: [] });
ok(/may already be gone/.test((await fail(T.deleteTranscript('a')))?.message), 'deleting something already gone says so');

// ---- the sign-in hand-off (kept one hour, remembers its owner)
ok(T.PENDING_KEY === 'sparkscribe.pendingSave', 'the parked transcript has a fixed key');
ok(T.peekPending() === null, 'nothing is parked at first');
ok(T.stashPending({ title: 'T', text: 'secret lecture' }, 'user-1') === true, 'a transcript can be parked');
const p = T.peekPending();
ok(p.title === 'T' && p.owner === 'user-1' && typeof p.at === 'number', 'it comes back with its owner and the time it was parked');
T.stashPending({ title: 'T2' });
ok(T.peekPending().owner === null, 'with no owner it is stored as null');
store.set(T.PENDING_KEY, JSON.stringify({ title: 'old', at: Date.now() - 61 * 60 * 1000 }));
ok(T.peekPending() === null && !store.has(T.PENDING_KEY), 'after an hour it is gone, and removed from the browser');
store.set(T.PENDING_KEY, JSON.stringify({ title: 'fresh', at: Date.now() - 59 * 60 * 1000 }));
ok(T.peekPending().title === 'fresh', 'just under an hour it is still offered');
store.set(T.PENDING_KEY, '{not json');
ok(T.peekPending() === null, 'damaged data reads as nothing parked');
T.stashPending({ title: 'x' });
T.clearPending();
ok(T.peekPending() === null, 'clearPending removes it');
globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
ok(T.stashPending({ title: 'x' }) === false && T.peekPending() === null, 'when browser storage is blocked, parking reports false and nothing breaks');
T.clearPending({ keepAudio: true });
ok(true, 'clearing with blocked storage does not throw');

console.log(`${pass} checks passed`);
