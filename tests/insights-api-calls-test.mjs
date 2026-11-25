// Browser side of the intelligence API (src/insights/api.js): requests, error shaping and the streamed answers (server-sent events).
// Supabase is "configured" with a made-up address through a Node module hook; fetch is the server stand-in, so nothing leaves this machine.
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

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const sent = [];
let reply = () => ({ status: 200, json: {} });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('db.invalid')) return new Response(JSON.stringify({ id: 'u1', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }), { status: 200, headers: { 'content-type': 'application/json' } });
  sent.push({ url: u, init, body: init.body ? JSON.parse(init.body) : null });
  const r = reply();
  if (r.throws) throw new TypeError('network down');
  if (r.chunks) {
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(c) { for (const x of r.chunks) c.enqueue(enc.encode(x)); if (r.breaks) c.error(new Error('reset')); else c.close(); },
    });
    return new Response(stream, { status: r.status || 200, headers: { 'content-type': 'text/event-stream' } });
  }
  return new Response(r.raw ?? JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } });
};
const api = await import(new URL('../src/insights/api.js', import.meta.url).href);
const { supabase } = await import(new URL('../src/lib/supabase.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const fail = async (p) => { try { await p; } catch (e) { return e; } return null; };
const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

// ---- signed out
let e = await fail(api.fetchState('t1'));
ok(e instanceof api.ApiError && e.status === 401 && e.code === 'unauthorized' && sent.length === 0, 'signed out: "Sign in to use this.", with no request made');

await supabase.auth.setSession({ access_token: TOKEN, refresh_token: 'r' });

// ---- plain calls
reply = () => ({ status: 200, json: { insights: [] } });
await api.fetchState('a b/c');
ok(sent.at(-1).url === '/api/insights?transcriptionId=a%20b%2Fc', 'the recording id is URL-encoded in the query');
ok(sent.at(-1).init.headers.Authorization === `Bearer ${TOKEN}` && sent.at(-1).init.headers['Content-Type'] === 'application/json', 'every call carries the access token');
await api.requestInsight('t1', 'summary', 'lecture');
ok(sent.at(-1).init.method === 'POST' && JSON.stringify(sent.at(-1).body) === '{"transcriptionId":"t1","kind":"summary","recordingType":"lecture","force":false}', 'requestInsight posts the id, kind, type and force=false');
await api.requestInsight('t1', 'summary', 'lecture', true);
ok(sent.at(-1).body.force === true, '…and force=true when asked to regenerate');
await api.acrossStatus(['a', 'b']);
ok(sent.at(-1).url === '/api/across' && sent.at(-1).body.action === 'status' && sent.at(-1).body.ids.join() === 'a,b', 'acrossStatus posts the ids to /api/across');
await api.acrossGuide(['a'], 'cells', 'req-1');
ok(sent.at(-1).body.action === 'guide' && sent.at(-1).body.focus === 'cells' && sent.at(-1).body.requestId === 'req-1', 'acrossGuide passes the focus and request id');
await api.acrossHistory();
ok(sent.at(-1).body.action === 'history', 'acrossHistory');
await api.acrossThread(['a']);
ok(sent.at(-1).body.action === 'thread', 'acrossThread');
await api.acrossDelete('x1');
ok(sent.at(-1).body.action === 'delete' && sent.at(-1).body.id === 'x1', 'acrossDelete');

// ---- plain-call errors
reply = () => ({ status: 429, json: { error: 'limit', message: 'Daily limit reached.', details: { resetAt: 'tomorrow' } } });
e = await fail(api.fetchState('t1'));
ok(e.status === 429 && e.code === 'limit' && e.message === 'Daily limit reached.' && e.details.resetAt === 'tomorrow', 'a server error keeps its message, code, status and details');
reply = () => ({ status: 502, raw: '<html>Bad gateway</html>' });
e = await fail(api.fetchState('t1'));
ok(e.status === 502 && e.code === 'error' && e.message === 'Request failed (502).' && e.details === null, 'a non-JSON error body gives a generic message');
reply = () => ({ throws: true });
e = await fail(api.fetchState('t1'));
ok(e.code === 'network' && e.status === 0 && /connection/.test(e.message), 'a dropped connection reads as a network error');

// ---- askQuestion (streamed)
const events = [];
reply = () => ({
  chunks: [
    sse('status', { status: 'searching' }),
    sse('status', { status: 'answering' }),
    sse('delta', { text: 'Hello ' }),
    // an event split across two network chunks
    'event: delta\ndata: {"text":"wor',
    'ld"}\n\n',
    sse('done', { id: 'a1', answer: 'Hello world', refs: [3], found: true, unsupported: false, cached: false }),
  ],
});
const answer = await api.askQuestion('t1', 'What?', 42, { onStatus: (s) => events.push(['s', s]), onDelta: (t) => events.push(['d', t]) });
ok(sent.at(-1).url === '/api/ask' && sent.at(-1).body.transcriptionId === 't1' && sent.at(-1).body.question === 'What?' && sent.at(-1).body.at === 42, 'the question, position and recording are posted to /api/ask');
ok(events.map((x) => x.join(':')).join('|') === 's:searching|s:answering|d:Hello |d:world', 'status and text events arrive in order, even when split across chunks');
ok(answer.answer === 'Hello world' && answer.refs[0] === 3 && answer.found === true, 'the final grounded answer is returned');
reply = () => ({ chunks: [sse('done', { id: 'a2', answer: 'x', refs: [], found: false })] });
ok((await api.askQuestion('t1', 'q', null)).id === 'a2', 'handlers are optional');
reply = () => ({ chunks: [': keep-alive\n\n', 'garbage\n\n', sse('done', { id: 'a3', answer: 'ok' })] });
ok((await api.askQuestion('t1', 'q', null)).id === 'a3', 'comment lines and blocks without an event are skipped');
reply = () => ({ chunks: [sse('delta', { text: 'partial' })] });
e = await fail(api.askQuestion('t1', 'q', null));
ok(e.code === 'incomplete' && e.status === 500, 'a stream that ends without a final answer is "incomplete"');
reply = () => ({ chunks: [sse('error', { error: 'ai_unavailable', message: 'The AI is busy.' })] });
e = await fail(api.askQuestion('t1', 'q', null));
ok(e.code === 'ai_unavailable' && e.message === 'The AI is busy.', 'an error event is thrown with its code and message');
reply = () => ({ status: 403, json: { error: 'plan', message: 'Upgrade to ask.' } });
e = await fail(api.askQuestion('t1', 'q', null));
ok(e.status === 403 && e.code === 'plan' && e.message === 'Upgrade to ask.', 'a refusal before streaming starts keeps its status and message');
reply = () => ({ throws: true });
e = await fail(api.askQuestion('t1', 'q', null));
ok(e.code === 'network', 'a failed request is a network error');

// ---- askAcross (streamed, with names and details)
const got = [];
reply = () => ({
  chunks: [sse('names', { 'Speaker 1': 'Hadi' }), sse('delta', { text: 'A' }), sse('done', { id: 'x', answer: 'A' })],
});
const across = await api.askAcross(['a', 'b'], 'compare?', 'req-9', { onNames: (n) => got.push(n), onDelta: (t) => got.push(t) });
ok(sent.at(-1).url === '/api/across' && sent.at(-1).body.action === 'ask' && sent.at(-1).body.requestId === 'req-9', 'askAcross posts an "ask" action with the request id');
ok(got[0]['Speaker 1'] === 'Hadi' && got[1] === 'A' && across.id === 'x', 'it reports speaker names and text as they arrive');
reply = () => ({ chunks: [sse('error', { error: 'gone', message: 'Some recordings are gone.', details: { missing: ['b'] } })] });
e = await fail(api.askAcross(['a', 'b'], 'q', 'r'));
ok(e.code === 'gone' && e.details.missing[0] === 'b', 'an error event keeps its details');
reply = () => ({ status: 404, json: { error: 'gone', message: 'Missing.', details: { missing: ['a'] } } });
e = await fail(api.askAcross(['a'], 'q', 'r'));
ok(e.status === 404 && e.details.missing[0] === 'a', 'a refusal before streaming keeps its details too');
reply = () => ({ chunks: [sse('delta', { text: 'half' })], breaks: true });
e = await fail(api.askAcross(['a'], 'q', 'r'));
ok(e.code === 'network' && /dropped/.test(e.message), 'a connection that drops mid-answer says so');
reply = () => ({ chunks: [sse('delta', { text: 'half' })] });
e = await fail(api.askAcross(['a'], 'q', 'r'));
ok(e.code === 'incomplete', 'a clean end without an answer is incomplete');

// ---- Create-tab tools (/api/tools)
reply = () => ({ status: 200, json: { ok: true } });
await api.gradeAnswer('t1', 'art1', 3, 'mitochondria');
ok(sent.at(-1).url === '/api/tools' && sent.at(-1).body.action === 'grade' && sent.at(-1).body.index === 3 && sent.at(-1).body.answer === 'mitochondria' && sent.at(-1).body.artifactId === 'art1', 'gradeAnswer sends the answer and which question it is for');
await api.requestFollowups('t1', 'art1', ['c1']);
ok(sent.at(-1).body.action === 'followups' && sent.at(-1).body.concepts[0] === 'c1', 'requestFollowups sends the concepts');
await api.prepareStudyMap('t1');
ok(sent.at(-1).body.action === 'prepare' && sent.at(-1).body.transcriptionId === 't1', 'prepareStudyMap asks the server to build the map ahead of time');
await api.requestTool('t1', 'quiz');
ok(sent.at(-1).body.kind === 'quiz' && JSON.stringify(sent.at(-1).body.settings) === '{}' && sent.at(-1).body.force === false, 'requestTool defaults to no settings and no force');
await api.requestTool('t1', 'quiz', { count: 5 }, true);
ok(sent.at(-1).body.settings.count === 5 && sent.at(-1).body.force === true, '…and passes settings and force through');

console.log(`${pass} checks passed`);
