// Word times for the lines where the speaker changes, on a GPU, in a worker of its own (engine/word-timing.js says why):
// started by worker.js for one recording and ended straight after, so the timing model's GPU memory is freed.
//   in:  { type: 'time', clips: [{ audio: Float32Array (16 kHz), offset: s, words: [...] }], dev: 'webgpu' }
//   out: { type: 'progress', … } (downloads) | { type: 'run-progress', done, total }
//        | { type: 'timed', times: [[{ s, e } | null, …] | null, …] (seconds in the recording), device } | { type: 'failed', message }
import { env } from '@huggingface/transformers';
import { chunkedCache } from './engine/model-cache.js';
import { loadTiming, timeClip } from './engine/word-timing.js';

if (typeof caches !== 'undefined') { env.useCustomCache = true; env.customCache = chunkedCache(env.cacheKey); }

self.onmessage = async ({ data }) => {
  if (data?.type !== 'time') return;
  try {
    const m = await loadTiming(data.dev, (p) => self.postMessage({ type: 'progress', ...p }));
    const times = [];
    for (const [k, clip] of data.clips.entries()) {
      try { times.push(await timeClip(m, clip)); } catch (err) { console.warn('Word timing failed for a line:', err); times.push(null); }
      self.postMessage({ type: 'run-progress', done: k + 1, total: data.clips.length });
    }
    self.postMessage({ type: 'timed', times, device: m.device });
  } catch (err) {
    self.postMessage({ type: 'failed', message: String(err?.message || err) });
  }
};
