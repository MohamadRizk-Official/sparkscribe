// The Anthropic provider (server/ai/anthropic.js) against a stand-in for fetch: the request it sends, how it reads a
// reply, how it fails, and how it reads a stream. No network and no key is used.
import assert from 'node:assert/strict';
const { anthropicProvider, AIError } = await import(new URL('../server/ai/anthropic.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const realFetch = globalThis.fetch;
const realError = console.error;
console.error = () => {}; // failed requests are logged by design; keep the test output clean
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const reply = (text, extra = {}) => json(200, { content: [{ type: 'text', text }], model: 'm-1', usage: { input_tokens: 10, output_tokens: 5 }, ...extra });
let calls = [];
const script = (...steps) => { calls = []; let i = 0; globalThis.fetch = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); const s = steps[Math.min(i++, steps.length - 1)]; if (s instanceof Error) throw s; return s; }; };
const rejects = async (p) => { try { await p; return null; } catch (e) { return e; } };

const p = anthropicProvider('test-key-not-real');
ok(p.name === 'anthropic', 'the provider names itself');

// ---- the request
script(reply('Hello'));
let r = await p.complete({ model: 'm-1', system: 'sys', messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 });
ok(calls.length === 1 && calls[0].init.method === 'POST', 'one POST is made');
ok(calls[0].init.headers['x-api-key'] === 'test-key-not-real' && calls[0].init.headers['anthropic-version'], 'the key and the API version go in headers');
ok(calls[0].body.model === 'm-1' && calls[0].body.max_tokens === 100 && calls[0].body.system === 'sys' && calls[0].body.messages.length === 1, 'model, limit, system prompt and messages are sent');
ok(!('output_config' in calls[0].body) && !('stream' in calls[0].body), 'no schema, effort or stream: none of those fields are sent');
ok(!JSON.stringify(calls[0].body).includes('test-key-not-real'), 'the key is never part of the body');
ok(r.text === 'Hello' && r.json === null && r.model === 'm-1', 'the text and model come back; json is null without a schema');

script(reply('{"a":1}'));
r = await p.complete({ model: 'm-1', system: 's', messages: [], maxTokens: 10, schema: { type: 'object' }, effort: 'low' });
ok(calls[0].body.output_config.format.type === 'json_schema' && calls[0].body.output_config.effort === 'low', 'a schema and an effort are sent as output_config');
ok(r.json.a === 1, 'with a schema the reply is parsed as JSON');

script(reply('{"a":1}', { model: undefined }));
r = await p.complete({ model: 'asked-for', system: 's', messages: [], maxTokens: 10 });
ok(r.model === 'asked-for', 'if the reply names no model, the requested one is reported');

script(json(200, { content: [{ type: 'text', text: 'A' }, { type: 'tool_use' }, { type: 'text', text: 'B' }], usage: {} }));
r = await p.complete({ model: 'm', system: 's', messages: [], maxTokens: 10 });
ok(r.text === 'AB', 'only the text blocks of a reply are joined');

// ---- usage
script(json(200, { content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 10, cache_read_input_tokens: 80, cache_creation_input_tokens: 5, output_tokens: 7 } }));
r = await p.complete({ model: 'm', system: 's', messages: [], maxTokens: 10 });
ok(r.usage.input === 95 && r.usage.uncached === 10 && r.usage.cacheRead === 80 && r.usage.cacheWrite === 5 && r.usage.output === 7, 'input counts every prompt token; the cached parts are reported separately');
script(json(200, { content: [], usage: undefined }));
r = await p.complete({ model: 'm', system: 's', messages: [], maxTokens: 10 });
ok(r.usage.input === 0 && r.usage.output === 0 && r.text === '', 'a reply with no usage or content is zero and empty');

// ---- failures
let e;
script(json(200, { content: [{ type: 'text', text: 'cut off' }], stop_reason: 'max_tokens' }));
e = await rejects(p.complete({ model: 'm', system: 's', messages: [], maxTokens: 10 }));
ok(e instanceof AIError && e.code === 'too_long', 'a reply that hit the token limit is "too_long"');
script(json(200, { content: [], stop_reason: 'refusal' }));
e = await rejects(p.complete({ model: 'm', system: 's', messages: [], maxTokens: 10 }));
ok(e instanceof AIError && e.code === 'refused', 'a declined reply is "refused"');
script(reply('not json'));
e = await rejects(p.complete({ model: 'm', system: 's', messages: [], maxTokens: 10, schema: {} }));
ok(e instanceof AIError && /unexpected format/.test(e.message), 'a schema reply that is not JSON is an unexpected format');
script(json(401, { error: { type: 'authentication_error', message: 'bad key test-key-not-real' } }));
e = await rejects(p.complete({ model: 'm', system: 's', messages: [], maxTokens: 10 }));
ok(e.status === 502 && /not set up correctly/.test(e.message) && !e.message.includes('test-key'), 'a rejected key is a 502 with a message that does not repeat what the service said');
ok(calls.length === 1, 'a 401 is not retried');
script(json(400, { error: { type: 'invalid_request_error' } }));
e = await rejects(p.complete({ model: 'm', system: 's', messages: [], maxTokens: 10 }));
ok(e.status === 502 && calls.length === 1, 'any other client error is a 502 and is not retried');
script(new TypeError('fetch failed'), new TypeError('fetch failed'));
e = await rejects(p.complete({ model: 'm', system: 's', messages: [], maxTokens: 10 }));
ok(e.status === 504 && /Could not reach/.test(e.message) && calls.length === 2, 'a network failure is tried twice, then a 504');
const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
script(timeout, reply('late'));
e = await rejects(p.complete({ model: 'm', system: 's', messages: [], maxTokens: 10 }));
ok(e.status === 504 && /too long/.test(e.message) && calls.length === 1, 'a timeout is never tried again');

// ---- a busy service is tried once more (waits 1.5 s)
script(json(529, { error: { type: 'overloaded_error' } }), reply('second time'));
r = await p.complete({ model: 'm', system: 's', messages: [], maxTokens: 10 });
ok(calls.length === 2 && r.text === 'second time', 'an overloaded service (529) is retried once and the second answer is used');
script(json(429, {}), json(429, {}));
e = await rejects(p.complete({ model: 'm', system: 's', messages: [], maxTokens: 10 }));
ok(calls.length === 2 && e.status === 503, 'rate limited twice: given up after two tries, as a 503');

// ---- streaming
const sse = (events) => new Response(new ReadableStream({ start(c) { const enc = new TextEncoder(); for (const ev of events) c.enqueue(enc.encode(`event: x\ndata: ${typeof ev === 'string' ? ev : JSON.stringify(ev)}\n\n`)); c.close(); } }), { status: 200 });
const delta = (t) => ({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } });
script(sse([{ type: 'message_start', message: { model: 'm-2', usage: { input_tokens: 12 } } }, delta('Hel'), delta('lo'), 'not json', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }]));
const got = [];
r = await p.stream({ model: 'm', system: 's', messages: [], maxTokens: 10 }, (d) => got.push(d));
ok(calls[0].body.stream === true, 'a stream request asks for a stream');
ok(got.join('|') === 'Hel|lo' && r.text === 'Hello', 'each piece is passed on as it arrives, and the whole text is returned');
ok(r.model === 'm-2' && r.usage.input === 12 && r.usage.output === 3 && r.truncated === false, 'model and usage come from the stream; it was not cut short');
script(sse([delta('x'), { type: 'message_delta', delta: { stop_reason: 'max_tokens' } }]));
r = await p.stream({ model: 'm', system: 's', messages: [], maxTokens: 10 }, () => {});
ok(r.truncated === true, 'a stream that stopped at the token limit is marked truncated');
script(sse([delta('x'), { type: 'error', error: { message: 'secret detail' } }]));
e = await rejects(p.stream({ model: 'm', system: 's', messages: [], maxTokens: 10 }, () => {}));
ok(e instanceof AIError && !/secret detail/.test(e.message), 'an error in the stream is reported without the service\'s own text');
script(sse([{ type: 'message_delta', delta: { stop_reason: 'refusal' } }]));
e = await rejects(p.stream({ model: 'm', system: 's', messages: [], maxTokens: 10 }, () => {}));
ok(e?.code === 'refused', 'a declined stream is "refused"');

globalThis.fetch = realFetch;
console.error = realError;
console.log(`${pass} checks passed`);
