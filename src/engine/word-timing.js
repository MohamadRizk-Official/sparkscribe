// Word times for transcript lines, for speaker splits (worker.js assignSpeakers, engine/speaker-words.js): forced
// alignment of a line's own words (lib/ctc-align.js) with the sentence-click timing model (wav2vec2-base-960h, half
// precision; same file and browser cache as align-worker.js, so nothing more to download once sentence clicks have used
// it). On a GPU it runs in a worker of its own (word-timing-worker.js), ended after use: in the transcription worker the
// runtime keeps freed GPU buffers pooled. On the processor it runs in the transcription worker, which reuses its own
// memory (a worker of its own measured about 2 GB more: PROTOCOL.md addendum 9b).
//   loadTiming(dev, progress_callback) -> { processor, model, vocab, device }
//   timeClip(timing, { audio, offset, words }) -> [{ s, e } | null] per word, seconds in the recording
import { AutoProcessor, AutoModelForCTC, AutoTokenizer } from '@huggingface/transformers';
import { forcedAlign, ALIGN_SETTINGS } from '../lib/ctc-align.js';
import { timingPlan } from '../lib/timing-plan.js';

const MODEL = 'Xenova/wav2vec2-base-960h';

export async function loadTiming(dev, progress_callback) {
  const processor = await AutoProcessor.from_pretrained(MODEL, { progress_callback });
  const plans = dev === 'webgpu' ? await timingPlan(self.navigator?.gpu) : [['wasm', 'fp16']];
  let last = null;
  for (const [device, dtype] of plans) {
    try {
      const model = await AutoModelForCTC.from_pretrained(MODEL, { device, dtype, progress_callback });
      const v = (await AutoTokenizer.from_pretrained(MODEL, { progress_callback })).get_vocab();
      return { processor, model, vocab: v instanceof Map ? Object.fromEntries(v) : v, device };
    } catch (err) { last = err; }
  }
  throw last;
}

export async function timeClip({ processor, model, vocab }, { audio, offset, words }) {
  let { logits } = await model(await processor(audio));
  if (logits.type === 'float16') logits = logits.to('float32');
  const [, frames, V] = logits.dims, d = logits.data, lp = new Float32Array(frames * V);
  for (let t = 0; t < frames; t++) {
    let mx = -Infinity;
    for (let v = 0; v < V; v++) mx = Math.max(mx, d[t * V + v]);
    let sum = 0;
    for (let v = 0; v < V; v++) sum += Math.exp(d[t * V + v] - mx);
    const lse = mx + Math.log(sum);
    for (let v = 0; v < V; v++) lp[t * V + v] = d[t * V + v] - lse;
  }
  return forcedAlign(lp, frames, vocab, words, ALIGN_SETTINGS).map((x) => (x ? { s: x.s + offset, e: x.e + offset } : null));
}
