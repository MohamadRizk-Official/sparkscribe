// server/http.js request parsing: size limit and malformed bodies, whether or not the platform pre-parsed the body.
import assert from 'node:assert/strict';
const { readJson } = await import(new URL('../server/http.js', import.meta.url).href);
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const rejects = async (req, status) => { try { await readJson(req); return false; } catch (e) { return e.status === status; } };
const stream = (s) => ({ async *[Symbol.asyncIterator]() { yield Buffer.from(s); } });
ok((await readJson({ body: { a: 1 } })).a === 1, 'pre-parsed object accepted');
ok(await rejects({ body: { q: 'x'.repeat(20_000) } }, 413), 'pre-parsed object over 16 KB → 413');
ok((await readJson({ body: '{"a":2}' })).a === 2, 'string body parsed');
ok(await rejects({ body: '{not json' }, 400), 'malformed string body → 400 (was an uncaught 500)');
ok(await rejects({ body: 'x'.repeat(20_000) }, 413), 'string body over 16 KB → 413');
const s = stream('{"b":3}'); ok((await readJson(s)).b === 3, 'streamed body parsed');
ok(await rejects(stream('{bad'), 400), 'malformed streamed body → 400');
ok(await rejects(stream('x'.repeat(20_000)), 413), 'streamed body over 16 KB → 413');
console.log(`\n${pass} checks passed`);
