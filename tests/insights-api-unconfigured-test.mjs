// Browser side of the intelligence API (src/insights/api.js) when Supabase is not configured: there is no session to
// send, so every call fails as a "network" ApiError and nothing is ever requested. Loaded through tests/vite-env-hook.mjs.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./vite-env-hook.mjs', import.meta.url);
let fetched = 0;
globalThis.fetch = async () => { fetched++; throw new Error('no network in tests'); };
const A = await import(new URL('../src/insights/api.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const fails = async (p) => { try { await p; return null; } catch (e) { return e; } };

// ---- ApiError ----
const e = new A.ApiError('boom', 'bad', 418);
ok(e instanceof Error && e instanceof A.ApiError, 'ApiError is an Error');
ok(e.message === 'boom' && e.code === 'bad' && e.status === 418, 'ApiError carries message, code and status');

// ---- every request helper fails the same way without an account ----
const calls = {
  fetchState: () => A.fetchState('t1'),
  requestInsight: () => A.requestInsight('t1', 'overview', 'lecture'),
  acrossStatus: () => A.acrossStatus(['a', 'b']),
  acrossGuide: () => A.acrossGuide(['a', 'b'], 'focus', 'r1'),
  acrossHistory: () => A.acrossHistory(),
  acrossThread: () => A.acrossThread(['a', 'b']),
  acrossDelete: () => A.acrossDelete('x'),
  gradeAnswer: () => A.gradeAnswer('t1', 'art', 0, 'answer'),
  requestFollowups: () => A.requestFollowups('t1', 'art', ['c1']),
  prepareStudyMap: () => A.prepareStudyMap('t1'),
  requestTool: () => A.requestTool('t1', 'quiz'),
  askQuestion: () => A.askQuestion('t1', 'what?', 12),
  askAcross: () => A.askAcross(['a', 'b'], 'what?', 'r1', {}),
};
for (const [name, run] of Object.entries(calls)) {
  const err = await fails(run());
  ok(err instanceof A.ApiError && err.code === 'network' && err.status === 0, `${name} fails with a network ApiError`);
}
ok((await fails(A.fetchState('t1'))).message === "Couldn't reach SparkScribe. Check your connection.", 'the message tells the user to check their connection');
ok(fetched === 0, 'no request is made without a signed-in session');

console.log(`${pass} checks passed`);
