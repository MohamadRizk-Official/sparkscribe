// Clicking a sentence: when does it start? (src/align-worker.js times the words, lib/seek.js picks the moment.)
//
// Every paragraph a person is likely to click (the ones on screen, the one under the pointer first) is word-timed in the
// background, one at a time, by forced alignment of its own words on this device; the previous paragraph's last words
// are aligned with it as context. A click on any sentence, the first one of a paragraph too, then starts just before
// its first word and never back into the speech before. Until a paragraph is timed: its first sentence starts at the
// paragraph's own start (no step back), later ones from the loudness envelope's estimate (lib/breath.js). Timings are
// kept with the audio on this device (never uploaded), so each paragraph is timed once. Not on touch-first or
// small-memory devices: there the estimates are used.
import { sentenceStarts, splitSentences } from './breath.js';
import { seekToSentence } from './seek.js';
import { putAlign } from './audio-store.js';

export const RATE = 16000; // the aligner's rate: full quality (an 8 kHz copy measured clearly worse)
const MAX_BYTES = 150e6;
const MODEL_TAG = 'w2v-ctc-fp16-onset1'; // timings stored by another model, lead-in or onset head are made again
const keyOf = (seg) => seg.start.toFixed(2);
const CONTEXT_WORDS = 3; // the previous paragraph's last words aligned as context …
const CONTEXT_GAP_S = 1.0; // … when it ended less than this before the paragraph

// the whole file decoded once, mono, as 16-bit samples (~115 MB per hour); null if it can't be
export async function decodeForTiming(blob) {
  if (!blob || blob.size > MAX_BYTES || typeof OfflineAudioContext === 'undefined') return null;
  if (blob.size > 40e6 && (navigator.deviceMemory || 8) < 4) return null;
  try {
    const ctx = new OfflineAudioContext(1, 1, RATE); // decodeAudioData resamples to the context's rate
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const n = buf.length, ch = buf.numberOfChannels, pcm = new Int16Array(n);
    const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let c = 0; c < ch; c++) v += chans[c][i];
      pcm[i] = Math.max(-32768, Math.min(32767, Math.round((v / ch) * 32767)));
    }
    return { pcm, rate: RATE };
  } catch { return null; }
}
// (kept for the loudness envelope of recordings saved before envelopes existed)
export const decodeLowRate = decodeForTiming;

const capable = () => {
  try {
    if (navigator.connection?.saveData) return false;
    if ((navigator.deviceMemory || 8) < 4) return false;
    return matchMedia('(pointer: fine)').matches; // phones and tablets: the estimates only
  } catch { return false; }
};
const wordsOf = (text) => String(text || '').trim().split(/\s+/).filter(Boolean);

// getSegs() -> [{ start, end, text, speaker }]; getEnv() -> envelope | null; getBlob() -> the audio File/Blob | null
export function createSentenceTiming({ getSegs, getEnv, getBlob }) {
  let timed = new Map(); // paragraph start key -> { w: [[w, s, e] | null, …], p: prevEnd | null } in seconds (absolute)
  let key = null; // recording id, once there is one: timings are kept with its audio
  let active = false, enabled = capable();
  let decoded = null, decoding = null, decodedFor = null;
  let worker = null, inFlight = null, seq = 0;
  // this device's timing speed: ms of work per second of paragraph audio, from finished paragraphs (not the first, which
  // includes loading the model); null until known. A click waits for its paragraph only if it will be ready in time.
  let msPerS = null, jobsDone = 0;
  const queue = []; // paragraph start keys, front = next
  const visible = new Set(); // paragraphs in (or near) view, tracked before timing starts too
  let saveTimer = 0, io = null;

  const indexOf = (k) => getSegs().findIndex((s) => keyOf(s) === k);

  async function ensureDecoded() {
    const blob = getBlob();
    if (!blob) return null;
    if (decodedFor === blob) return decoded || decoding;
    decodedFor = blob;
    decoded = null;
    decoding = decodeForTiming(blob).then((d) => { if (decodedFor === blob) decoded = d; return d; });
    return decoding;
  }

  // the paragraph's audio (a little before, more before when the previous paragraph's last words come along as context)
  function clipFor(d, segs, i) {
    const seg = segs[i], prev = segs[i - 1];
    const context = prev && seg.start - prev.end < CONTEXT_GAP_S ? wordsOf(prev.text).slice(-CONTEXT_WORDS) : [];
    const from = context.length ? Math.min(seg.start - 0.3, prev.end - 1.5) : seg.start - 0.3;
    const a = Math.max(0, Math.floor(from * d.rate)), b = Math.min(d.pcm.length, Math.ceil((seg.end + 0.2) * d.rate));
    const audio = new Float32Array(b - a);
    for (let j = a; j < b; j++) audio[j - a] = d.pcm[j] / 32768;
    return { audio, offset: a / d.rate, words: [...context, ...wordsOf(seg.text)], context: context.length, start: seg.start - a / d.rate };
  }

  function persist() {
    clearTimeout(saveTimer);
    if (!key || !timed.size) return;
    saveTimer = setTimeout(() => {
      const s = {};
      for (const [k, t] of timed) s[k] = t;
      putAlign(key, { v: 2, model: MODEL_TAG, s });
    }, 1500);
  }

  async function pump() {
    if (!active || !enabled || inFlight || !queue.length) return;
    const k = queue.shift();
    const i = indexOf(k);
    if (i < 0 || timed.has(k) || !wordsOf(getSegs()[i].text).length) return pump();
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
          if (jobsDone++ > 0) { const r = (performance.now() - job.sent) / job.dur; msPerS = msPerS == null ? r : 0.7 * msPerS + 0.3 * r; }
          const at = (t) => +(t + job.offset).toFixed(3);
          timed.set(job.k, { w: data.words.map((x) => (x ? [x[0], at(x[1]), at(x[2])] : null)), p: data.prevEnd == null ? null : at(data.prevEnd) });
          persist();
          job.done?.();
        }
        // a failure (model couldn't load, out of memory…) stops timing for this page; the estimates stay in use
        if (data.type === 'failed') { enabled = false; job.done?.(); return; }
        pump();
      };
      worker.onerror = () => { enabled = false; inFlight?.done?.(); inFlight = null; };
    }
    const c = clipFor(d, getSegs(), i);
    inFlight = { id: ++seq, k, offset: c.offset, done: waiters.get(k), sent: performance.now(), dur: c.audio.length / d.rate };
    waiters.delete(k);
    worker.postMessage({ type: 'align', id: seq, audio: c.audio, words: c.words, context: c.context, start: c.start }, [c.audio.buffer]);
  }
  const waiters = new Map(); // paragraph key -> called when its timing is done (or failed)

  function want(i, urgent = false) {
    const seg = getSegs()[i];
    if (!enabled || !seg) return;
    const k = keyOf(seg);
    if (timed.has(k) || inFlight?.k === k) return;
    const at = queue.indexOf(k);
    if (at >= 0) { if (!urgent) return; queue.splice(at, 1); }
    if (urgent) queue.unshift(k); else queue.push(k);
    pump();
  }

  const api = {
    // timings saved earlier with this audio, and the recording id to keep new ones under (older models' are ignored)
    load(stored, recKey) {
      key = recKey || key;
      if (stored?.v === 2 && stored.model === MODEL_TAG && stored.s) timed = new Map(Object.entries(stored.s));
    },
    setKey(recKey) { key = recKey; persist(); },
    // start timing: the paragraphs already in view first (top to bottom), then whatever comes into view
    activate() {
      if (active || !enabled || !getBlob()) return;
      active = true;
      for (const i of [...visible].sort((a, b) => a - b)) want(i);
      pump();
    },
    // start timing once the page is idle, with nobody clicking yet: on a computer without a graphics card a paragraph
    // takes a few seconds to time, longer than a click can wait, so the ones on screen are timed ahead of the clicks
    prepare() {
      if (active || !enabled) return;
      const idle = self.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
      idle(() => api.activate(), { timeout: 4000 });
    },
    // the paragraphs in view are timed in the background; the one under the pointer goes first
    observe(container) {
      if (!enabled || typeof IntersectionObserver === 'undefined') return;
      io?.disconnect();
      io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          const i = Number(e.target.dataset.i);
          if (e.isIntersecting) { visible.add(i); if (active) want(i); } else visible.delete(i);
        }
      }, { rootMargin: '200px 0px' });
      const watch = () => container.querySelectorAll('.seg[data-i]').forEach((el) => io.observe(el));
      watch();
      new MutationObserver(() => { io.disconnect(); visible.clear(); watch(); }).observe(container, { childList: true, subtree: true });
      container.addEventListener('pointerover', (e) => {
        const p = e.target.closest?.('.seg[data-i]');
        if (!p || !getBlob()) return;
        api.activate();
        want(Number(p.dataset.i), true);
      });
    },
    // is paragraph i word-timed yet?
    isTimed(i) { const seg = getSegs()[i]; return !!seg && timed.has(keyOf(seg)); },
    // where to start sentence k of paragraph i, `text` = the paragraph as shown
    startOf(i, k, text) {
      const segs = getSegs(), seg = segs[i];
      if (!seg) return 0;
      const t = timed.get(keyOf(seg));
      if (t) {
        const s = seekToSentence({ text: text ?? seg.text, k, words: t.w.filter(Boolean), prevEnd: t.p ?? -Infinity });
        if (s != null) return s;
      }
      // not timed (yet): the paragraph's own start for its first sentence (stepping back into the pause before it
      // landed in the previous speaker's words far more often), the envelope's estimate for the others
      if (k === 0 || splitSentences(text ?? seg.text).length === 1) return Math.max(0, seg.start);
      const st = sentenceStarts(segs, i, getEnv(), { text });
      return st[Math.min(k, st.length - 1)] ?? seg.start;
    },
    // time paragraph i now (a click on a paragraph not timed yet), resolved when done or after `ms`. If it can't be
    // ready within `ms` (a slow device, the model still loading, other paragraphs ahead of it), it resolves at once:
    // playback starts from the estimate without a pointless wait, and the paragraph is timed next for later clicks.
    timeNow(i, ms = 1500) {
      const seg = getSegs()[i];
      if (!enabled || !seg || timed.has(keyOf(seg))) return Promise.resolve();
      api.activate();
      const now = performance.now(), own = Math.max(0.5, seg.end - seg.start + 0.5);
      const busy = inFlight ? Math.max(0, inFlight.sent + (msPerS ?? Infinity) * inFlight.dur - now) : 0;
      const eta = msPerS == null ? Infinity : inFlight?.k === keyOf(seg) ? busy : busy + msPerS * own;
      if (eta > ms) { want(i, true); return Promise.resolve(); }
      return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        const finish = () => { clearTimeout(timer); resolve(); };
        if (inFlight?.k === keyOf(seg)) { const before = inFlight.done; inFlight.done = () => { before?.(); finish(); }; return; } // already being timed
        waiters.set(keyOf(seg), finish);
        want(i, true);
      });
    },
    ensureDecoded,
    reset() { timed = new Map(); key = null; queue.length = 0; visible.clear(); active = false; enabled = capable(); decoded = null; decoding = null; decodedFor = null; inFlight = null; waiters.clear(); clearTimeout(saveTimer); },
  };
  if (import.meta.env?.DEV) { api.debug = () => ({ active, enabled, queued: queue.length, inFlight: inFlight?.k ?? null, timed: timed.size, decoded: !!decoded, key }); (self.__sentenceTimings ||= []).push(api); }
  return api;
}
