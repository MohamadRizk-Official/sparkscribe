// The second speaker model's pinned download list (src/engine/nemotron-files.js): every file has a SHA-256 to check,
// the base URL is pinned to one commit (not a moving branch), and the half-precision base is the first copy offered.
//   node tests/nemotron-pinned-test.mjs
import assert from 'node:assert/strict';
import { NEMOTRON_BASE, NEMOTRON_FILES, NEMOTRON_F16_BASE, NEMOTRON_F16_SOURCES } from '../src/engine/nemotron-files.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

ok(/^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\/$/.test(NEMOTRON_BASE), 'the model base URL is pinned to a full 40-character commit and ends with a slash');
ok(Object.keys(NEMOTRON_FILES).sort().join() === 'embed,mel,silence,stepCpu,stepGpu', 'the file table names the five files the workers use');
for (const [key, [name, sha]] of Object.entries(NEMOTRON_FILES)) {
  ok(/^[a-z0-9_.]+\.(onnx|bin)$/.test(name), `${key}: ${name} is a plain file name, no path`);
  ok(/^[0-9a-f]{64}$/.test(sha), `${key}: the SHA-256 is 64 lowercase hex characters`);
}
ok(new Set(Object.values(NEMOTRON_FILES).map((f) => f[1])).size === 5, 'no two files share a checksum');
ok(new Set(Object.values(NEMOTRON_FILES).map((f) => f[0])).size === 5, 'no two files share a name');
ok(NEMOTRON_F16_SOURCES.length >= 1 && NEMOTRON_F16_SOURCES.every(([base, [name, sha]]) => /^https:\/\/.+\/$/.test(base) && /\.onnx$/.test(name) && /^[0-9a-f]{64}$/.test(sha)), 'every half-precision source is an https base ending in a slash plus a checked .onnx file');
ok(NEMOTRON_F16_BASE === NEMOTRON_F16_SOURCES[0][0], 'NEMOTRON_F16_BASE is the first half-precision source');
console.log(`\n${pass} checks passed`);
