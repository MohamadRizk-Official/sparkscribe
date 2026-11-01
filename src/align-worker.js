// Word timing for clicking a sentence (lib/sentence-timing.js): forced alignment of a paragraph's OWN words against its
// audio with a small letter-level speech model (wav2vec2-base-960h, half precision, ~189 MB), lib/ctc-align.js. Unlike transcribing
// again, it can only place the words it is given. The previous paragraph's last words are aligned first as context, so
// the end of the speech before is placed too instead of being blamed on this paragraph's first word. Runs on this
// device, in the background, one paragraph at a time; nothing is uploaded. Measured against human word times
// (accuracy/seek-eval.mjs, AMI). The aligned starts are then moved to where each word most likely begins, by a small
// word-onset head (lib/onset-head.js) on the same model's hidden features: the model's letters of a drawn-out first word
// sit near its end, so its aligned start alone is late (lib/ctc-align.js refineStarts). The hidden features come from
// the same model file, with one more output appended as it is loaded (lib/onnx-output.js); if the head can't load, the
// aligned starts are used as they are.
//   in:  { type: 'align', id, audio: Float32Array (16 kHz mono), words: [context…, paragraph…], context: n,
//          start: seconds from the clip's start where the paragraph's speaker turn begins }
//   out: { type: 'aligned', id, words: [[word, start, end] | null, …] (the paragraph's, seconds from the clip's start),
//          prevEnd: seconds | null (where the context speech ended) } | { type: 'failed', id }
//        | { type: 'loaded', device, dtype, onset } (once: which model runs where, and whether the onset head runs, which
//          needs both its weights and the model's hidden output)
import { AutoProcessor, AutoModelForCTC, AutoTokenizer, env } from '@huggingface/transformers';
import { chunkedCache } from './engine/model-cache.js';
import { alignParagraph, refineStarts, ALIGN_SETTINGS, ONSET_SETTINGS } from './lib/ctc-align.js';
import { withExtraOutput } from './lib/onnx-output.js';
import { loadOnsetHead, onsetScores } from './lib/onset-head.js';
import { timingPlan } from './lib/timing-plan.js';

const MODEL = 'Xenova/wav2vec2-base-960h';
const HIDDEN = '/wav2vec2/encoder/layers.8/final_layer_norm/Add_1_output_0'; // the onset head's input
const ONSET_HEAD = new URL('/models/onset-head-v1.bin', self.location.origin).href;
// the timing model's file, half (model_fp16.onnx) or full precision (model.onnx): loaded with the hidden output added
const modelFile = (url) => String(url?.url ?? url).match(/wav2vec2-base-960h\/resolve\/[^/]+\/onnx\/model(_fp16)?\.onnx$/);
async function withHidden(response, m) {
  if (!response?.ok) return response;
  const bytes = withExtraOutput(new Uint8Array(await response.arrayBuffer()), HIDDEN, m[1] ? 10 : 1);
  return new Response(bytes, { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) } });
}
const baseFetch = env.fetch;
env.fetch = async (url, init) => { const m = modelFile(url); const r = await baseFetch(url, init); return m ? withHidden(r, m) : r; };
if (typeof caches !== 'undefined') {
  const cache = chunkedCache(env.cacheKey);
  env.useCustomCache = true;
  env.customCache = { match: async (req) => { const m = modelFile(req); const r = await cache.match(req); return m && r ? withHidden(r, m) : r; }, put: (req, res) => cache.put(req, res) };
}

let model = null, processor = null, vocab = null, head = null;
const queue = [];
let busy = false;

// Half precision (189 MB): word times as good as the full model's; the 8-bit one (95 MB) placed first words
// noticeably worse (good clicks 61 % against 76 %, accuracy/research/speaker-2026-10-30/PROTOCOL.md). On the GPU where
// WebGPU works (about 0.1 s per paragraph), otherwise on the processor (several seconds per paragraph); lib/timing-plan.js.
async function load() {
  if (model) return;
  processor = await AutoProcessor.from_pretrained(MODEL);
  let last = null;
  for (const [device, dtype] of await timingPlan(self.navigator?.gpu)) {
    try {
      model = await AutoModelForCTC.from_pretrained(MODEL, { device, dtype });
      head = await loadHead();
      const hidden = !!Object.values(model.sessions || {}).some((s) => s?.outputNames?.includes(HIDDEN));
      self.postMessage({ type: 'loaded', device, dtype, onset: !!head && hidden });
      break;
    } catch (err) { last = err; }
  }
  if (!model) throw last;
  const v = (await AutoTokenizer.from_pretrained(MODEL)).get_vocab();
  vocab = v instanceof Map ? Object.fromEntries(v) : v;
}

async function loadHead() {
  try { const r = await fetch(ONSET_HEAD); return r.ok ? loadOnsetHead(await r.arrayBuffer()) : null; } catch { return null; }
}

// log-softmax over the letters, per 20 ms frame
function logSoftmax(data, frames, V) {
  const lp = new Float32Array(frames * V);
  for (let t = 0; t < frames; t++) {
    let mx = -Infinity;
    for (let v = 0; v < V; v++) mx = Math.max(mx, data[t * V + v]);
    let sum = 0;
    for (let v = 0; v < V; v++) sum += Math.exp(data[t * V + v] - mx);
    const lse = mx + Math.log(sum);
    for (let v = 0; v < V; v++) lp[t * V + v] = data[t * V + v] - lse;
  }
  return lp;
}

async function next() {
  if (busy || !queue.length) return;
  busy = true;
  const { id, audio, words, context = 0, start = null } = queue.shift();
  try {
    await load();
    const out = await model.forward(await processor(audio)); // all outputs: letters, and the hidden features when added
    let { logits } = out;
    if (logits.type === 'float16') logits = logits.to('float32'); // (the half-precision model keeps full-precision outputs; just in case)
    const [, frames, V] = logits.dims;
    const hidden = out[HIDDEN];
    // with the onset head, the alignment that absorbs untranscribed speech (both chosen together, ctc-align.js);
    // without it, the plain alignment measured before (PROTOCOL.md addendum 2)
    const al = alignParagraph(logSoftmax(logits.data, frames, V), frames, vocab, words.slice(0, context), words.slice(context), start, head && hidden ? ALIGN_SETTINGS : {});
    if (head && hidden?.dims?.[1] === frames) al.words = refineStarts(al.words, onsetScores(head, hidden.data, frames), 0, ONSET_SETTINGS);
    self.postMessage({
      type: 'aligned', id,
      words: al.words.map((x) => (x ? [x.w, +x.s.toFixed(3), +x.e.toFixed(3)] : null)),
      prevEnd: al.prevEnd == null ? null : +al.prevEnd.toFixed(3),
    });
  } catch (err) {
    self.postMessage({ type: 'failed', id, message: String(err?.message || err) });
  } finally {
    busy = false;
    next();
  }
}

self.onmessage = ({ data }) => {
  if (data?.type === 'align') { queue.push(data); next(); }
};
