// Browser-compatibility guards that can be checked in Node: behaviour with and without optional APIs.
import assert from 'node:assert/strict';
const { compressionRatio } = await import(new URL('../src/engine/decoding.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

const loop = 'the the the the the the the the the the the the the the the the the the the the the the the the';
const normal = 'We agreed that the launch moves to Monday and Sam sends the slides by Friday afternoon.';
const withApi = [await compressionRatio(loop), await compressionRatio(normal)];
ok(withApi[0] > 2.4 && withApi[1] < 2.4, `with CompressionStream: a runaway repetition scores ${withApi[0].toFixed(2)} (> 2.4), normal speech ${withApi[1].toFixed(2)}`);

const saved = globalThis.CompressionStream;
delete globalThis.CompressionStream;
try {
  ok((await compressionRatio(loop)) === 1 && (await compressionRatio(normal)) === 1, 'without it (Safari < 16.4): returns 1 instead of throwing, so transcription still runs');
} finally { globalThis.CompressionStream = saved; }
ok((await compressionRatio(loop)) === withApi[0], 'restored: identical result to before');

console.log(`\n${pass} checks passed`);
