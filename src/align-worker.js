// Word timing for clicking a sentence (lib/sentence-timing.js): a small Whisper (tiny.en, timestamped export, ~41 MB
// quantized) listens to one paragraph's audio and says when each word starts. It runs on this device, in the
// background, one paragraph at a time; nothing is uploaded. Its words are only used for timing: the transcript text
// stays the one the main engine wrote.
//   in:  { type: 'align', id, audio: Float32Array (16 kHz mono) }
//   out: { type: 'aligned', id, words: [[word, start, end], …] (seconds from the clip's start) } | { type: 'failed', id }
import { pipeline, env } from '@huggingface/transformers';
import { chunkedCache } from './engine/model-cache.js';

const MODEL = 'onnx-community/whisper-tiny.en_timestamped';
if (typeof caches !== 'undefined') { env.useCustomCache = true; env.customCache = chunkedCache(env.cacheKey); }

let asr = null;
const queue = [];
let busy = false;

async function next() {
  if (busy || !queue.length) return;
  busy = true;
  const { id, audio } = queue.shift();
  try {
    asr ||= await pipeline('automatic-speech-recognition', MODEL, { device: 'wasm', dtype: 'q8' });
    const r = await asr(audio, { return_timestamps: 'word' });
    const words = (r.chunks || []).filter((c) => c.text.trim()).map((c) => [c.text.trim(), +c.timestamp[0].toFixed(2), +(c.timestamp[1] ?? c.timestamp[0]).toFixed(2)]);
    self.postMessage({ type: 'aligned', id, words });
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
