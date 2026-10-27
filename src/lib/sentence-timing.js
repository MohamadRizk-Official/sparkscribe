// Clicking a sentence: when does it start? (lib/breath.js has the rules, src/align-worker.js times the words.)
//
// A paragraph is one piece of audio with one start time, but holds several sentences. Once someone starts using
// playback, the paragraphs on screen (and first the one under the pointer) are timed word by word in the background,
// one at a time, by a small model on this device. Until a paragraph is timed, its sentences start from the loudness
// envelope's estimate. Timings are kept with the audio on this device (never uploaded), so each paragraph is timed
// once. Not on touch-first or small-memory devices: there the envelope estimate is used.
import { sentenceStartsTimed, splitSentences } from './breath.js';
import { putAlign } from './audio-store.js';

export const LOW_RATE = 8000; // the copy used for timing (and the envelope): half the speech model's rate is enough
const MAX_BYTES = 150e6;
const MODEL_TAG = 'tiny.en-ts-q8';
const keyOf = (seg) => seg.start.toFixed(2);

// the whole file decoded once at a low rate, mono, as 16-bit samples (~58 MB per hour); null if it can't be
export async function decodeLowRate(blob) {
  if (!blob || blob.size > MAX_BYTES || typeof OfflineAudioContext === 'undefined') return null;
  if (blob.size > 40e6 && (navigator.deviceMemory || 8) < 4) return null;
  try {
    const ctx = new OfflineAudioContext(1, 1, LOW_RATE); // decodeAudioData resamples to the context's rate
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const n = buf.length, ch = buf.numberOfChannels, pcm = new Int16Array(n);
    const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let c = 0; c < ch; c++) v += chans[c][i];
      pcm[i] = Math.max(-32768, Math.min(32767, Math.round((v / ch) * 32767)));
    }
    return { pcm, rate: LOW_RATE };
  } catch { return null; }
}

const capable = () => {
  try {
    if (navigator.connection?.saveData) return false;
    if ((navigator.deviceMemory || 8) < 4) return false;
    return matchMedia('(pointer: fine)').matches; // phones and tablets: the envelope estimate only
  } catch { return false; }
};

// getSegs() -> [{ start, end, text, speaker }]; getEnv() -> envelope | null; getBlob() -> the audio File/Blob | null
export function createSentenceTiming({ getSegs, getEnv, getBlob }) {
  let words = new Map(); // paragraph start key -> [[w, s, e], …] in seconds (absolute)
  let key = null; // recording id, once there is one: timings are kept with its audio
  let active = false, enabled = capable();
  let decoded = null, decoding = null, decodedFor = null;
  let worker = null, inFlight = null, seq = 0;
  const queue = []; // paragraph start keys, front = next
  let saveTimer = 0, io = null;

  const segByKey = (k) => getSegs().find((s) => keyOf(s) === k);
  function multi(seg) { return seg && splitSentences(seg.text).length > 1; }

  async function ensureDecoded() {
    const blob = getBlob();
    if (!blob) return null;
    if (decodedFor === blob) return decoded || decoding;
    decodedFor = blob;
    decoded = null;
    decoding = decodeLowRate(blob).then((d) => { if (decodedFor === blob) decoded = d; return d; });
    return decoding;
  }

  function clip(d, seg) {
    const a = Math.max(0, Math.floor((seg.start - 0.3) * d.rate)), b = Math.min(d.pcm.length, Math.ceil((seg.end + 0.2) * d.rate));
    const f = 16000 / d.rate; // 2: linear upsampling to the model's 16 kHz
    const out = new Float32Array((b - a) * f);
    for (let i = a; i < b; i++) {
      const v0 = d.pcm[i] / 32768, v1 = (i + 1 < b ? d.pcm[i + 1] : d.pcm[i]) / 32768;
      for (let k = 0; k < f; k++) out[(i - a) * f + k] = v0 + ((v1 - v0) * k) / f;
    }
    return { audio: out, offset: a / d.rate };
  }

  function persist() {
    clearTimeout(saveTimer);
    if (!key || !words.size) return;
    saveTimer = setTimeout(() => {
      const s = {};
      for (const [k, w] of words) s[k] = w;
      putAlign(key, { v: 1, model: MODEL_TAG, s });
    }, 1500);
  }

  async function pump() {
    if (!active || !enabled || inFlight || !queue.length) return;
    const k = queue.shift();
    const seg = segByKey(k);
    if (!seg || words.has(k) || !multi(seg)) return pump();
    const d = await ensureDecoded();
    if (!d) { enabled = false; return; }
    if (inFlight) { queue.unshift(k); return; }
    if (!worker) {
      worker = new Worker(new URL('../align-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        const job = inFlight;
        if (!job || data.id !== job.id) return;
        inFlight = null;
        if (data.type === 'aligned') {
          words.set(job.k, data.words.map(([w, s, e]) => [w, +(s + job.offset).toFixed(2), +(e + job.offset).toFixed(2)]));
          persist();
        }
        // a failure (model couldn't load, out of memory…) stops timing for this page; the estimate stays in use
        if (data.type === 'failed') { enabled = false; return; }
        pump();
      };
      worker.onerror = () => { enabled = false; inFlight = null; };
    }
    const { audio, offset } = clip(d, seg);
    inFlight = { id: ++seq, k, offset };
    worker.postMessage({ type: 'align', id: seq, audio }, [audio.buffer]);
  }

  function want(i, urgent = false) {
    const seg = getSegs()[i];
    if (!enabled || !seg || !multi(seg)) return;
    const k = keyOf(seg);
    if (words.has(k) || inFlight?.k === k) return;
    const at = queue.indexOf(k);
    if (at >= 0) { if (!urgent) return; queue.splice(at, 1); }
    if (urgent) queue.unshift(k); else queue.push(k);
    pump();
  }

  const api = {
    // timings saved earlier with this audio, and the recording id to keep new ones under
    load(stored, recKey) {
      key = recKey || key;
      if (stored?.v === 1 && stored.model === MODEL_TAG && stored.s) words = new Map(Object.entries(stored.s));
    },
    setKey(recKey) { key = recKey; persist(); },
    // start timing (after the first play, click or pointer on the transcript): nothing runs before that
    activate() {
      if (active || !enabled || !getBlob()) return;
      active = true;
      pump();
    },
    // the paragraphs in view are timed in the background; the one under the pointer goes first
    observe(container) {
      if (!enabled || typeof IntersectionObserver === 'undefined') return;
      io?.disconnect();
      io = new IntersectionObserver((entries) => {
        if (!active) return;
        for (const e of entries) if (e.isIntersecting) want(Number(e.target.dataset.i));
      }, { rootMargin: '200px 0px' });
      const watch = () => container.querySelectorAll('.seg[data-i]').forEach((el) => io.observe(el));
      watch();
      new MutationObserver(() => { io.disconnect(); watch(); }).observe(container, { childList: true, subtree: true });
      container.addEventListener('pointerover', (e) => {
        const p = e.target.closest?.('.seg[data-i]');
        if (!p || !getBlob()) return;
        api.activate();
        want(Number(p.dataset.i), true);
      });
    },
    // where to start sentence k of paragraph i, `text` = the paragraph as shown
    startOf(i, k, text) {
      const segs = getSegs(), seg = segs[i];
      if (!seg) return 0;
      const st = sentenceStartsTimed(segs, i, getEnv(), words.get(keyOf(seg)), { text });
      return st[Math.min(k, st.length - 1)] ?? seg.start;
    },
    ensureDecoded,
    reset() { words = new Map(); key = null; queue.length = 0; active = false; enabled = capable(); decoded = null; decoding = null; decodedFor = null; inFlight = null; clearTimeout(saveTimer); },
  };
  if (import.meta.env?.DEV) { api.debug = () => ({ active, enabled, queued: queue.length, inFlight: inFlight?.k ?? null, timed: words.size, decoded: !!decoded, key }); (self.__sentenceTimings ||= []).push(api); }
  return api;
}
