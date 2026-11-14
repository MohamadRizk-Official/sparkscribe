// AI usage meter (server/ai/usage.js createMeter): what is logged per call, failed calls, cached results, ledger settling.
// console.log is captured; nothing is written to disk (AI_USAGE_LOG is cleared).
import assert from 'node:assert/strict';
delete process.env.AI_USAGE_LOG;
const { createMeter } = await import(new URL('../server/ai/usage.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

// capture the "[ai-usage] {json}" lines
const real = console.log;
const lines = [];
const capture = async (fn) => {
  lines.length = 0;
  console.log = (...a) => { const s = a.join(' '); if (s.startsWith('[ai-usage] ')) lines.push(JSON.parse(s.slice(11))); else real(...a); };
  try { return await fn(); } finally { console.log = real; }
};

const usage = { input: 1200, uncached: 200, cacheWrite: 0, cacheRead: 1000, output: 300 };
const meter = () => createMeter({ feature: 'notes', transcriptionId: 't1', userId: 'u1' });

// ---- call() passes the provider result through and records usage
await capture(async () => {
  const m = meter();
  const r = await m.call('write', async () => ({ model: 'claude-haiku-5-5', usage, text: 'x' }));
  ok(r.text === 'x', 'call() returns the provider result unchanged');
  await m.finish({ groundingPassed: true, droppedItems: 2 });
});
ok(lines.length === 1, 'one call, one log line');
const l = lines[0];
ok(l.feature === 'notes' && l.task === 'write' && l.transcriptionId === 't1' && l.userId === 'u1', 'the line names feature, task, transcription and user');
ok(l.model === 'claude-haiku-5-5' && l.inputTokens === 1200 && l.uncachedInputTokens === 200 && l.cacheReadTokens === 1000 && l.outputTokens === 300, 'tokens are recorded as reported');
ok(l.cached === false && l.groundingPassed === true && l.droppedItems === 2 && l.actualCostUsd === null, 'finish() flags are on the line; actual cost is not known');
ok(l.estimatedCostUsd === Math.round((200 * 0.10 + 1000 * 0.01 + 300 * 0.50) / 1e6 * 1e7) / 1e7, 'estimated cost matches the price table');
ok(typeof l.latencyMs === 'number' && l.latencyMs >= 0 && typeof l.ts === 'string', 'latency and a timestamp are present');
ok(!('error' in l), 'no error field on success');

// ---- usage without an uncached count falls back to the input count
await capture(async () => {
  const m = meter();
  await m.call('t', async () => ({ model: 'claude-haiku-5-5', usage: { input: 500, output: 10 } }));
  await m.finish();
});
ok(lines[0].uncachedInputTokens === 500, 'uncached defaults to the input count');

// ---- a failed call is logged with zero tokens and the error is rethrown
await capture(async () => {
  const m = meter();
  await assert.rejects(() => m.call('t', async () => { throw new Error('boom'); }), /boom/);
  await m.finish({ error: 'upstream' });
});
ok(lines.length === 1 && lines[0].failed === true && lines[0].inputTokens === 0 && lines[0].estimatedCostUsd === 0, 'a rejected call is logged as failed at no cost');
ok(lines[0].error === 'upstream', 'finish({ error }) is added to the line');

// ---- several calls, one line each
await capture(async () => {
  const m = meter();
  await m.call('a', async () => ({ model: 'claude-haiku-5-5', usage }));
  await m.call('b', async () => ({ model: 'claude-haiku-5-5', usage }));
  await m.finish();
});
ok(lines.length === 2 && lines[0].task === 'a' && lines[1].task === 'b', 'every call gets its own line, in order');

// ---- a result served from storage
await capture(async () => { await meter().finish({ cached: true }); });
ok(lines.length === 1 && lines[0].cached === true && lines[0].model === null && lines[0].estimatedCostUsd === 0 && lines[0].task === 'notes', 'a cached result logs one zero-cost line');

// ---- refused
await capture(async () => { meter().refused('over_limit'); });
ok(lines[0].refused === 'over_limit' && lines[0].outputTokens === 0 && lines[0].cached === false, 'refused() logs the reason with zero tokens');

// ---- ledger settling
const settled = [];
await capture(async () => {
  const m = meter();
  m.slot = 7; m.onSettle = (okFlag, totals) => settled.push([okFlag, totals]);
  await m.call('a', async () => ({ model: 'claude-haiku-5-5', usage }));
  await m.finish();
  ok(m.slot === null, 'the slot is cleared once settled');
  await m.finish();
});
ok(settled.length === 1, 'a reservation is settled once, even if finish() runs twice');
ok(settled[0][0] === true && settled[0][1].input === 1200 && settled[0][1].output === 300, 'settle gets success and the real token totals');
ok(settled[0][1].costMicrousd === Math.round((200 * 0.10 + 1000 * 0.01 + 300 * 0.50)), 'settle gets the cost in micro-dollars');

await capture(async () => {
  const m = meter();
  m.slot = 1; m.onSettle = (okFlag) => settled.push(['err', okFlag]);
  await m.finish({ error: 'x' });
});
ok(settled[1][1] === false, 'an errored action settles with success = false');

await capture(async () => {
  const m = meter();
  m.slot = 1; m.onSettle = () => { throw new Error('ledger down'); };
  await m.finish(); // must not throw
});
ok(true, 'a failing settle never throws out of finish()');
console.log(`${pass} checks passed`);
