# Extra ONNX output (`src/lib/onnx-output.js`)

Adds one more output tensor to an ONNX model file in the browser, so the app can read a hidden layer from the same file it already downloads and caches (used for the word-timing model's hidden features in `align-worker.js`). No modified copy is hosted. Covered by `tests/onnx-output-test.mjs`.

## Why it works
An ONNX file is a protobuf `ModelProto`. Protobuf merges a repeated or embedded message field when it appears twice, so appending a second `graph` field (number 7) that holds only an `output` entry (number 12) adds that tensor to the graph's outputs. Nothing inside the file is parsed or rewritten.

## Functions
- `extraOutputBytes(name, elemType)` returns the bytes to append: `graph { output { name, type { tensor_type { elem_type } } } }`. Lengths are written as protobuf varints, so names over 127 bytes work.
- `withExtraOutput(bytes, name, elemType)` returns `bytes` plus that field, as a new `Uint8Array`.
  - Accepts a `Uint8Array` or an `ArrayBuffer`; the input is never modified.
  - If the file already ends with exactly this field, the same array is returned (calling it twice is safe).
  - A different name or a different element type counts as a different output and is appended.

`elemType` is the ONNX `TensorProto` data type: `1` = float32, `10` = float16.
