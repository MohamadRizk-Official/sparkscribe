// AI cost estimate (server/ai/usage.js estimateCost): per-model prices, cache rates, Haiku long-prompt tier, unknown models.
import assert from 'node:assert/strict';
const { estimateCost } = await import(new URL('../server/ai/usage.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const near = (a, b) => Math.abs(a - b) < 1e-9;

// Haiku 5.5: $0.10 in, $0.125 cache write, $0.01 cache read, $0.50 out, per million tokens
ok(near(estimateCost('claude-haiku-5-5', { uncached: 100_000 }), 0.01), 'Haiku: 100k uncached input tokens cost $0.01');
ok(near(estimateCost('claude-haiku-5-5', { output: 1e6 }), 0.50), 'Haiku: 1M output tokens cost $0.50');
ok(near(estimateCost('claude-haiku-5-5', { cacheWrite: 80_000 }), 0.01), 'Haiku: 80k cache-write tokens cost $0.01');
ok(near(estimateCost('claude-haiku-5-5', { cacheRead: 100_000 }), 0.001), 'Haiku: 100k cache-read tokens cost $0.001');
ok(near(estimateCost('claude-haiku-5-5', { uncached: 10_000, output: 2_000 }), 0.001 + 0.001), 'input and output add up');
ok(estimateCost('claude-haiku-5-5', {}) === 0, 'no tokens cost nothing');

// the long tier applies when the whole prompt (uncached + cache write + cache read) is over 100k tokens
ok(near(estimateCost('claude-haiku-5-5', { uncached: 100_000 }), 0.01), 'exactly 100k prompt tokens still pay the normal rate');
ok(near(estimateCost('claude-haiku-5-5', { uncached: 100_001 }), 100_001 * 0.50 / 1e6), '100,001 prompt tokens pay the long rate');
ok(near(estimateCost('claude-haiku-5-5', { uncached: 50_000, cacheRead: 60_000, output: 1e6 }), (50_000 * 0.50 + 60_000 * 0.05 + 1e6 * 2.50) / 1e6),
  'cache reads count toward the long-prompt threshold, and the whole call is then priced at long rates');

// other models have no long tier
ok(near(estimateCost('claude-sonnet-5-5', { uncached: 1e6, output: 1e6 }), 12), 'Sonnet: $2 in + $10 out per million');
ok(near(estimateCost('claude-sonnet-5-5', { uncached: 500_000 }), 1), 'Sonnet has no long tier');
ok(near(estimateCost('claude-opus-5-5', { uncached: 1e6, cacheWrite: 1e6, cacheRead: 1e6, output: 1e6 }), 4 + 5 + 0.2 + 20), 'Opus: all four rates');

// model lookup: exact id, then prefix, otherwise null
ok(near(estimateCost('claude-haiku-5-5-20261001', { uncached: 100_000 }), 0.01), 'a dated model id matches by prefix');
ok(estimateCost('some-other-model', { uncached: 1e6 }) === null, 'an unknown model has no estimate (null)');
ok(estimateCost(null, { uncached: 1 }) === null, 'a missing model has no estimate (null)');
ok(estimateCost(undefined, {}) === null, 'undefined model, empty usage: null');

// rounding to 7 decimal places
ok(estimateCost('claude-haiku-5-5', { uncached: 1 }) === 0.0000001, 'one token rounds to 1e-7 dollars');
ok(estimateCost('claude-haiku-5-5', { cacheRead: 1 }) === 0, 'a single cache-read token rounds down to 0');
console.log(`${pass} checks passed`);
