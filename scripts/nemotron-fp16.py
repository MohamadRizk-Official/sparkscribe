# Half-precision copy of the second speaker model's step (Nemotron 3 Diarization, NVIDIA, OpenMDW-1.1; ONNX export by
# NealCaren/Nemotron-3-Diarization-ONNX at 46642c09…): 199 MB instead of 396 MB, inputs and outputs kept in full
# precision. The float16 converter leaves some Cast nodes casting to the wrong type; they are set to what their output
# needs. Rebuilds byte-for-byte: step.onnx (SHA-256 cd7fa5b0…) -> step_fp16.onnx (SHA-256 ae823473…), src/worker.js.
#   pip install onnx onnxconverter-common
#   python scripts/nemotron-fp16.py step.onnx step_fp16.onnx
import sys, onnx
from onnx import TensorProto as T
from onnxconverter_common import float16

src, dst = sys.argv[1], sys.argv[2]
m = float16.convert_float_to_float16(onnx.load(src), keep_io_types=True)
g = m.graph
want = {v.name: v.type.tensor_type.elem_type for v in list(g.value_info) + list(g.output) + list(g.input)}
fixed = 0
for n in g.node:
    if n.op_type == 'Cast':
        for a in n.attribute:
            if a.name == 'to' and want.get(n.output[0]) in (T.FLOAT, T.FLOAT16) and a.i != want[n.output[0]]:
                a.i = want[n.output[0]]; fixed += 1
onnx.shape_inference.infer_shapes(m, strict_mode=True)
onnx.save(m, dst)
print('casts fixed', fixed)
