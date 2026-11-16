// Small server helpers (server/http.js): isUuid, isRecoveryToken, sendJson, sendError.
import assert from 'node:assert/strict';
const { isUuid, isRecoveryToken, sendJson, sendError } = await import(new URL('../server/http.js', import.meta.url).href);
const { AIError } = await import(new URL('../server/ai/provider.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

// ---- isUuid
ok(isUuid('123e4567-e89b-12d3-a456-426614174000'), 'a lower-case uuid is accepted');
ok(isUuid('123E4567-E89B-12D3-A456-426614174000'), 'an upper-case uuid is accepted');
ok(!isUuid('123e4567e89b12d3a456426614174000'), 'a uuid without dashes is refused');
ok(!isUuid('123e4567-e89b-12d3-a456-42661417400'), 'one character short is refused');
ok(!isUuid('123e4567-e89b-12d3-a456-4266141740000'), 'one character long is refused');
ok(!isUuid('123e4567-e89b-12d3-a456-42661417400g'), 'a non-hex character is refused');
ok(!isUuid(' 123e4567-e89b-12d3-a456-426614174000'), 'a leading space is refused');
ok(!isUuid('123e4567-e89b-12d3-a456-426614174000\n'), 'a trailing newline is refused');
ok(!isUuid(null) && !isUuid(undefined) && !isUuid(42) && !isUuid({}), 'only strings can be uuids');

// ---- isRecoveryToken: reads the newest sign-in method from the token's claims
const jwt = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
ok(isRecoveryToken(jwt({ amr: [{ method: 'recovery', timestamp: 100 }] })), 'a token whose only method is recovery is a recovery token');
ok(isRecoveryToken(jwt({ amr: [{ method: 'password', timestamp: 100 }, { method: 'recovery', timestamp: 200 }] })), 'recovery as the newest method counts, whatever its position');
ok(!isRecoveryToken(jwt({ amr: [{ method: 'recovery', timestamp: 100 }, { method: 'password', timestamp: 200 }] })), 'a password sign-in after the recovery link makes it a normal session');
ok(!isRecoveryToken(jwt({ amr: [{ method: 'password', timestamp: 100 }] })), 'a normal sign-in is not a recovery token');
ok(!isRecoveryToken(jwt({ amr: [] })), 'an empty method list is not a recovery token');
ok(!isRecoveryToken(jwt({})), 'a token without methods is not a recovery token');
ok(!isRecoveryToken(jwt({ amr: 'recovery' })), 'methods that are not a list are ignored');
ok(!isRecoveryToken('not-a-token'), 'a string with no dots is not a recovery token');
ok(!isRecoveryToken('a.!!!.c'), 'unreadable claims are not a recovery token');
ok(!isRecoveryToken(undefined) && !isRecoveryToken(null), 'a missing token is not a recovery token');

// ---- sendJson / sendError
const fakeRes = () => ({ headers: {}, statusCode: 0, body: null, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } });
let res = fakeRes();
sendJson(res, 201, { a: 1 });
ok(res.statusCode === 201 && JSON.parse(res.body).a === 1, 'sendJson writes the status and the JSON body');
ok(/^application\/json/.test(res.headers['Content-Type']) && res.headers['Cache-Control'] === 'no-store', '…as uncached JSON');

res = fakeRes();
sendError(res, new AIError('Too many requests.', { status: 429, code: 'rate_limited' }));
let body = JSON.parse(res.body);
ok(new AIError('x').status === 502 && new AIError('x').code === 'ai_error', 'an AIError defaults to 502 ai_error');
ok(res.statusCode === 429 && body.error === 'rate_limited' && body.message === 'Too many requests.', 'an AIError keeps its status, code and message');
ok(!('details' in body), '…and has no details when it carries none');

res = fakeRes();
const gone = new AIError('Some are gone.', { status: 404, code: 'not_found' });
gone.details = { missing: ['a'] }; // set by the caller after construction
sendError(res, gone);
ok(JSON.parse(res.body).details.missing[0] === 'a', 'details on an AIError are passed to the page');

res = fakeRes();
const quiet = console.error;
const logged = [];
console.error = (...a) => logged.push(a.join(' '));
try { sendError(res, new Error('secret token abc123 leaked')); } finally { console.error = quiet; }
body = JSON.parse(res.body);
ok(res.statusCode === 500 && body.error === 'server_error', 'any other error is a 500 server_error');
ok(!res.body.includes('abc123') && !logged.join(' ').includes('abc123'), '…and its message is never sent to the client or the log');
ok(body.message === 'Something went wrong. Try again.', '…the client sees a generic message');

console.log(`${pass} checks passed`);
