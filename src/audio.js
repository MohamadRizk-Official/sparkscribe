// Turn any audio/video file into 16 kHz mono Float32 samples — what Whisper and pyannote expect.
//
// Two paths:
//  1. Fast path: the browser's own decoder (decodeAudioData). Great for short files, but it
//     unpacks the entire file into raw memory at once, so it dies on long recordings and on
//     codecs the browser doesn't ship.
//  2. Robust path: FFmpeg compiled to WebAssembly. Handles every format and streams the
//     conversion, so an hour-long voice message is fine. The file is mounted, not copied into memory. Costs a one-time download (~31 MB of WebAssembly, ~9 MB over the network compressed).
import { fetchBlobURL, withTimeout, StallError } from './lib/fetch-progress.js';
export const SAMPLE_RATE = 16000;

const FAST_PATH_MAX_SECONDS = 15 * 60; // beyond this, go straight to FFmpeg
const FAST_PATH_MAX_BYTES = 40 * 1e6;

export async function decodeToMono16k(file, onStatus = () => {}, { forceFFmpeg = false } = {}) {
  const duration = await probeDuration(file); // null if the browser can't even read the header
  const useFast = !forceFFmpeg && duration !== null && duration <= FAST_PATH_MAX_SECONDS && file.size <= FAST_PATH_MAX_BYTES;

  if (useFast) {
    try {
      onStatus('Decoding audio…');
      return await decodeWithBrowser(file);
    } catch (err) {
      console.warn('Browser decode failed, falling back to FFmpeg:', err);
    }
  }
  return decodeWithFFmpeg(file, onStatus);
}

// Ask an <audio> element for the duration without decoding the whole file.
function probeDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = document.createElement('audio');
    a.preload = 'metadata';
    const done = (v) => { URL.revokeObjectURL(url); a.src = ''; resolve(v); };
    const timer = setTimeout(() => done(null), 6000);
    a.onloadedmetadata = () => { clearTimeout(timer); done(Number.isFinite(a.duration) ? a.duration : null); };
    a.onerror = () => { clearTimeout(timer); done(null); };
    a.src = url;
  });
}

async function decodeWithBrowser(file) {
  const bytes = await file.arrayBuffer();
  const probe = new (window.AudioContext || window.webkitAudioContext)();
  let decoded;
  try {
    decoded = await probe.decodeAudioData(bytes);
  } finally {
    probe.close().catch(() => {});
  }
  const length = Math.ceil(decoded.duration * SAMPLE_RATE);
  const offline = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded; // the offline context resamples + mixes to mono for us
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return { samples: rendered.getChannelData(0), duration: decoded.duration };
}

let ffmpegPromise = null;
async function getFFmpeg(onStatus) {
  if (ffmpegPromise) return ffmpegPromise;
  ffmpegPromise = (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const ff = new FFmpeg();
    const base = `${location.origin}/ffmpeg`;
    onStatus('Loading audio converter (one-time download)…');
    const mb = (n) => (n / 1048576).toFixed(0);
    try {
      const coreURL = await fetchBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript');
      const wasmURL = await fetchBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm', {
        onProgress: (got, total) => onStatus(`Loading audio converter… ${total >= got ? `${Math.round((got / total) * 100)}%` : `${mb(got)} of ~31 MB`}`), // unpacked bytes; a compressed response (Vercel: ~9 MB Brotli) has no usable total
      });
      // starting it compiles ~32 MB of WebAssembly: allow a slow device, but not forever
      await withTimeout(ff.load({ coreURL, wasmURL }), 90_000, 'The audio converter didn’t start.', () => ff.terminate());
    } catch (err) {
      if (err instanceof StallError) throw Object.assign(new Error(`The audio converter couldn’t load: ${err.message} Recordings under 15 minutes in MP3, WAV, M4A or WebM usually don’t need it.`), { code: 'converter_unavailable' });
      throw err;
    }
    return ff;
  })();
  ffmpegPromise.catch(() => { ffmpegPromise = null; });
  return ffmpegPromise;
}

// The FFmpeg worker that is converting right now (null when idle): cancelling stops it for real, rather than
// letting a long conversion keep the CPU and memory busy behind the next file.
let busyFF = null;
export function abortDecode() {
  if (!busyFF) return;
  try { busyFF.terminate(); } catch { /* already gone */ }
  busyFF = null;
  ffmpegPromise = null; // a terminated worker can't be reused; the next file loads a fresh one (from the HTTP cache)
}

async function decodeWithFFmpeg(file, onStatus) {
  const ff = await getFFmpeg(onStatus);
  const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'bin').toLowerCase();
  const outName = 'out.f32';
  const dir = '/input';
  let inName = null, mounted = false;

  let lastPct = -1;
  const onProgress = ({ progress }) => {
    if (busyFF !== ff) return; // a cancelled conversion never updates the screen of the next file
    const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
    if (pct !== lastPct) { lastPct = pct; onStatus(`Converting audio… ${pct}%`); }
  };
  ff.on('progress', onProgress);
  busyFF = ff;
  try {
    onStatus('Converting audio…');
    // The file is read by FFmpeg straight from disk (WORKERFS): a 1 GB video is not copied into memory first.
    // Browsers without it get the old way (one in-memory copy).
    try {
      await ff.createDir(dir).catch(() => {});
      await ff.mount('WORKERFS', { files: [file] }, dir);
      mounted = true;
      inName = `${dir}/${file.name}`;
    } catch {
      inName = `in.${ext}`;
      await ff.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
    }
    // -vn: drop video, mono, 16 kHz, raw 32-bit float samples (no WAV header to parse)
    const code = await ff.exec(['-i', inName, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', outName]);
    if (busyFF !== ff) throw Object.assign(new Error('Cancelled.'), { code: 'cancelled' });
    if (code !== 0) throw new Error(`FFmpeg could not read this file (exit code ${code}).`);
    const data = await ff.readFile(outName);
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
    // The worker hands over a buffer of its own: view it in place (no second ~230 MB-per-hour copy) when aligned.
    const samples = bytes.byteOffset % 4 === 0 && bytes.byteLength % 4 === 0
      ? new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
      : new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength - (bytes.byteLength % 4)));
    if (!samples.length) throw new Error('FFmpeg produced no audio. Is there an audio track in this file?');
    return { samples, duration: samples.length / SAMPLE_RATE };
  } finally {
    if (busyFF === ff) {
      busyFF = null;
      ff.off('progress', onProgress);
      if (mounted) await ff.unmount(dir).catch(() => {});
      else if (inName) await ff.deleteFile(inName).catch(() => {});
      await ff.deleteFile(outName).catch(() => {});
    }
  }
}

// Downsample to N peaks for drawing a waveform.
export function peaks(samples, n = 400) {
  const block = Math.max(1, Math.floor(samples.length / n));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let max = 0;
    const start = i * block;
    const end = Math.min(samples.length, start + block);
    for (let j = start; j < end; j++) {
      const v = Math.abs(samples[j]);
      if (v > max) max = v;
    }
    out[i] = max;
  }
  return out;
}
