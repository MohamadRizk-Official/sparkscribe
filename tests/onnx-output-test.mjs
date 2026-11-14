// Appending an extra graph output to an ONNX file (src/lib/onnx-output.js): the exact protobuf bytes, idempotence, input handling.
import assert from 'node:assert/strict';
const { extraOutputBytes, withExtraOutput } = await import(new URL('../src/lib/onnx-output.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ---- extraOutputBytes: graph (field 7) { output (field 12) { name (1), type (2) { tensor_type (1) { elem_type (1) } } } }
const a = extraOutputBytes('h', 1);
// valueInfo = [0x0a,1,'h'] + [0x12,4,0x0a,2,0x08,1] = 9 bytes; output field = [0x62,9,...]; graph field = [0x3a,11,...]
ok(same(a, [0x3a, 11, 0x62, 9, 0x0a, 1, 0x68, 0x12, 4, 0x0a, 2, 0x08, 1]), 'a one-letter float32 output is the expected protobuf bytes');
ok(a instanceof Uint8Array, 'extraOutputBytes returns a Uint8Array');
ok(extraOutputBytes('h', 10)[a.length - 1] === 10, 'elem type 10 (float16) lands in the last byte');
ok(extraOutputBytes('hidden', 1).length === a.length + 5, 'a name five characters longer adds five bytes');
ok(same(extraOutputBytes('x', 1), extraOutputBytes('x', 1)), 'same inputs, same bytes');

// ---- varint lengths: a name over 127 bytes needs a two-byte length
const long = extraOutputBytes('n'.repeat(200), 1);
ok(long[0] === 0x3a && (long[1] & 0x80) === 0x80, 'a long name makes the outer length a multi-byte varint (high bit set)');

// ---- withExtraOutput
const model = Uint8Array.from([1, 2, 3, 4, 5]);
const withOut = withExtraOutput(model, 'h', 1);
ok(withOut.length === model.length + a.length, 'the new file is the old one plus the appended field');
ok(same(withOut.slice(0, 5), model), 'the original bytes are unchanged at the front');
ok(same(withOut.slice(5), a), 'the field is appended at the end');
ok(same(model, [1, 2, 3, 4, 5]), 'the input array is not modified');
ok(withExtraOutput(withOut, 'h', 1) === withOut, 'appending the same output again returns the same bytes (idempotent)');
ok(withExtraOutput(withOut, 'h', 10).length === withOut.length + extraOutputBytes('h', 10).length, 'a different elem type is a different output and is appended');
ok(withExtraOutput(withOut, 'g', 1).length > withOut.length, 'a different name is appended too');

// ---- input types
const fromBuffer = withExtraOutput(model.buffer.slice(0), 'h', 1);
ok(fromBuffer instanceof Uint8Array && same(fromBuffer, withOut), 'an ArrayBuffer input works');
ok(same(withExtraOutput(new Uint8Array(0), 'h', 1), a), 'an empty file just gets the field');
console.log(`${pass} checks passed`);
