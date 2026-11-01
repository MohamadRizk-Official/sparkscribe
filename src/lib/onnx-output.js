// One more output for an ONNX model file, without hosting a modified copy: an ONNX file is a protobuf ModelProto, and
// protobuf merges a repeated embedded message field, so appending a second `graph` field (7) that holds only an
// `output` entry (12) adds that tensor to the graph's outputs. Used to read the word-timing model's hidden features
// (align-worker.js) from the same file the app already downloads and caches.
//   withExtraOutput(bytes, name, elemType) -> Uint8Array (bytes unchanged if that output was appended already)
// elemType: ONNX TensorProto data type, 1 = float32, 10 = float16.
const varint = (n) => { const b = []; while (n > 127) { b.push((n & 127) | 128); n >>>= 7; } b.push(n); return b; };
const field = (no, bytes) => [(no << 3) | 2, ...varint(bytes.length), ...bytes];

export function extraOutputBytes(name, elemType) {
  const nameBytes = [...new TextEncoder().encode(name)];
  // ValueInfoProto { name (1), type (2): TypeProto { tensor_type (1): Tensor { elem_type (1, varint) } } }
  const valueInfo = [...field(1, nameBytes), ...field(2, field(1, [(1 << 3) | 0, ...varint(elemType)]))];
  return Uint8Array.from(field(7, field(12, valueInfo)));
}

export function withExtraOutput(bytes, name, elemType) {
  const add = extraOutputBytes(name, elemType);
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (src.length >= add.length && add.every((b, i) => src[src.length - add.length + i] === b)) return src;
  const out = new Uint8Array(src.length + add.length);
  out.set(src);
  out.set(add, src.length);
  return out;
}
