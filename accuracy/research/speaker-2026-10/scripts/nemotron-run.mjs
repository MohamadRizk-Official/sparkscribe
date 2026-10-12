// Nemotron-3-Diarization (community ONNX graphs, int8) — offline inference in Node, ported from the Apache-2.0
// `transformers` reference: NemotronAsrStreamingFeatureExtractor (front end) and
// Nemotron3DiarizationForAudioFrameClassification.forward (offline chunking) + Nemotron3DiarizationSpeakerCache.
//   node nemotron-run.mjs <audio> <out.json> [--seconds N] [--dump dump.json] [--features feats.bin]
// Output: SparkScribe run format (segments with speaker S0..S7, overlapping segments where two speakers talk).
// Pinned to 8 CPUs, below-normal priority, one model call at a time; no downloads.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import os from 'node:os';

const ROOT = 'C:/Users/wael2/Downloads/neuralscribe/';
const HERE = 'C:/Users/wael2/AppData/Local/Temp/claude/C--Users-wael2-Downloads-neuralscribe/54ead60f-839e-4688-9326-f3fa68f8d2be/scratchpad/nemotron/';
try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
const NC = os.cpus().length;
if (NC > 8) execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${process.pid}).ProcessorAffinity = ${((1n << 8n) - 1n) << BigInt(NC - 8)}`]);
const ort = createRequire(ROOT + 'package.json')('onnxruntime-node');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const [audioF, outF] = args;
const t0 = performance.now();

// ---------- audio (raw 16 kHz mono, as the reference expects) ----------
globalThis.self ??= globalThis;
const dir = ROOT + 'node_modules/@ffmpeg/core/dist/esm/';
globalThis.location ??= { href: pathToFileURL(dir + 'ffmpeg-core.js').href };
const { default: cf } = await import(pathToFileURL(dir + 'ffmpeg-core.js').href);
const core = await cf({ wasmBinary: readFileSync(dir + 'ffmpeg-core.wasm'), locateFile: (p) => dir + p });
const ext = audioF.split('.').pop();
core.FS.writeFile('in.' + ext, readFileSync(audioF)); core.exec('-i', 'in.' + ext, '-ac', '1', '-ar', '16000', '-f', 'f32le', 'o.raw');
const raw = core.FS.readFile('o.raw'); let audio = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
if (opt('--seconds')) audio = audio.slice(0, Math.round(Number(opt('--seconds')) * 16000));
// small files come back as a slice of Node's shared buffer pool: copy exactly the file's bytes
const f32file = (f) => { const b = readFileSync(f); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const SR = 16000, HOP = 160, NFFT = 512, WIN = 400, NMEL = 128, NBIN = NFFT / 2 + 1, GUARD = 2 ** -24;

// ---------- front end (reference: preemphasis -> torch.stft(center=True, constant pad, symmetric hann 400 in 512)
//            -> |X|^2 -> slaney mel (librosa, float32) -> log(x + 2^-24); keep floor(L / hop) frames) ----------
function features(x) {
  const L = x.length;
  const pre = new Float32Array(L); pre[0] = x[0]; for (let i = 1; i < L; i++) pre[i] = x[i] - 0.97 * x[i - 1];
  const nValid = Math.floor(L / HOP);
  const win = new Float64Array(NFFT); const off = (NFFT - WIN) / 2;
  for (let n = 0; n < WIN; n++) win[off + n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (WIN - 1)); // periodic=False
  const mel = f32file(HERE + 'mel_filters.bin'); // [128, 257]
  const out = new Float32Array(nValid * NMEL);
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT), pw = new Float64Array(NBIN);
  // bit reversal + twiddles for a radix-2 FFT of 512
  const rev = new Uint16Array(NFFT); for (let i = 0, j = 0; i < NFFT; i++) { rev[i] = j; let b = NFFT >> 1; while (j & b) { j ^= b; b >>= 1; } j |= b; }
  const cosT = new Float64Array(NFFT / 2), sinT = new Float64Array(NFFT / 2);
  for (let k = 0; k < NFFT / 2; k++) { cosT[k] = Math.cos((2 * Math.PI * k) / NFFT); sinT[k] = -Math.sin((2 * Math.PI * k) / NFFT); }
  const pad = NFFT / 2;
  for (let f = 0; f < nValid; f++) {
    const start = f * HOP - pad; // centered frame on a zero-padded signal
    for (let n = 0; n < NFFT; n++) { const s = start + n; const v = s >= 0 && s < L ? pre[s] : 0; re[rev[n]] = v * win[n]; im[rev[n]] = 0; }
    for (let size = 2; size <= NFFT; size <<= 1) {
      const half = size >> 1, step = NFFT / size;
      for (let i = 0; i < NFFT; i += size) for (let k = 0; k < half; k++) {
        const c = cosT[k * step], s = sinT[k * step], a = i + k, b = a + half;
        const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
    for (let k = 0; k < NBIN; k++) pw[k] = re[k] * re[k] + im[k] * im[k];
    for (let m = 0; m < NMEL; m++) { let acc = 0; const row = m * NBIN; for (let k = 0; k < NBIN; k++) acc += mel[row + k] * pw[k]; out[f * NMEL + m] = Math.log(acc + GUARD); }
  }
  return { feats: out, n: nValid };
}
const { feats, n: numFrames } = features(audio);
if (opt('--features')) writeFileSync(opt('--features'), Buffer.from(feats.buffer));
const tFeat = performance.now();

// ---------- model graphs ----------
const so = { intraOpNumThreads: 8, interOpNumThreads: 1, graphOptimizationLevel: 'all' };
const embedS = await ort.InferenceSession.create(HERE + 'embed.onnx', so);
const stepS = await ort.InferenceSession.create(HERE + 'step_int8.onnx', so);
const silence = f32file(HERE + 'silence_embeds.bin');
const H = 512, K = 8, SUB = 8;
const emb = (await embedS.run({ features: new ort.Tensor('float32', feats, [1, numFrames, NMEL]) })).embeds;
const T = emb.dims[1]; const E = emb.data; // [T, 512]
const row = (i) => E.subarray(i * H, (i + 1) * H);

// ---------- speaker cache (reference: Nemotron3DiarizationSpeakerCache, offline sizes) ----------
const CFG = { cacheLen: 264, silenceFrames: 1, predThr: 0.25, latestBoost: 0.05, minPosRate: 0.5, strongRate: 0.75, weakRate: 1.5,
  fifoLen: 40, updatePeriod: 300, chunkLen: 340, rightContext: 40 };
// descending by score, ties by index; written without subtraction so that Infinity / -Infinity compare correctly
const byScoreDesc = (x, y) => (x[0] < y[0]) - (x[0] > y[0]) || x[1] - y[1];
const budget = Math.floor(CFG.cacheLen / K) - CFG.silenceFrames;
const minPositive = Math.floor(budget * CFG.minPosRate), nStrong = Math.floor(budget * CFG.strongRate), nWeak = Math.floor(budget * CFG.weakRate);
let cacheE = [], cacheP = [], fifo = [], compressed = false; // arrays of Float32Array rows (embeds) / prob rows

function frameScores(probs) { // [N][K] -> scores [N][K]
  const thr = CFG.predThr, N = probs.length;
  const sc = probs.map((p) => {
    const lp = p.map((v) => Math.log(Math.max(v, thr))), lc = p.map((v) => Math.log(Math.max(1 - v, thr)));
    const sumLc = lc.reduce((a, b) => a + b, 0);
    return p.map((v, k) => (v > 0.5 ? lp[k] - lc[k] + sumLc - Math.log(0.5) : -Infinity));
  });
  for (let k = 0; k < K; k++) {
    let pos = 0; for (let i = 0; i < N; i++) if (sc[i][k] > 0) pos++;
    if (pos >= minPositive) for (let i = 0; i < N; i++) if (!(sc[i][k] > 0) && probs[i][k] > 0.5) sc[i][k] = -Infinity;
  }
  return sc;
}
function boost(sc, num, b) { // per speaker: top-`num` frames by score get +b
  for (let k = 0; k < K; k++) {
    const idx = sc.map((r, i) => [r[k], i]).sort(byScoreDesc).slice(0, num);
    for (const [, i] of idx) sc[i][k] += b;
  }
}
function compress(embs, probs) {
  const N = probs.length;
  const sc = frameScores(probs);
  for (let i = CFG.cacheLen; i < N; i++) for (let k = 0; k < K; k++) sc[i][k] += CFG.latestBoost;
  boost(sc, nStrong, -2 * Math.log(0.5)); boost(sc, nWeak, -Math.log(0.5));
  for (let s = 0; s < CFG.silenceFrames; s++) sc.push(new Array(K).fill(Infinity)); // silence slots
  const NS = N + CFG.silenceFrames, sentinel = NS * K;
  const flat = []; for (let k = 0; k < K; k++) for (let i = 0; i < NS; i++) flat.push([sc[i][k], k * NS + i]); // speaker-major
  flat.sort(byScoreDesc);
  const top = flat.slice(0, CFG.cacheLen).map(([s, idx]) => (s === -Infinity ? sentinel : idx)).sort((a, b) => a - b);
  const outE = [], outP = [];
  for (const idx of top) { const f = idx === sentinel ? N : Math.min(idx % NS, N); outE.push(f === N ? silence : embs[f]); outP.push(f === N ? new Array(K).fill(0) : probs[f]); }
  return [outE, outP];
}
function update(stepInput, stepLogits, numChunkFrames) { // stepInput: rows; stepLogits: Float32 [rows*8, K]
  const nCache = cacheE.length, nFifo = fifo.length, rows = stepInput.length;
  const probs = []; // avg-pool of sigmoid over 8 sub-frames -> one per encoder frame
  for (let r = 0; r < rows; r++) { const p = new Array(K).fill(0); for (let s = 0; s < SUB; s++) for (let k = 0; k < K; k++) p[k] += 1 / (1 + Math.exp(-stepLogits[(r * SUB + s) * K + k])); probs.push(p.map((v) => v / SUB)); }
  const chunkStart = nCache + nFifo;
  const fifoE = [...fifo, ...stepInput.slice(chunkStart, chunkStart + numChunkFrames)];
  const nf = fifoE.length;
  const popped = nf <= CFG.fifoLen ? 0 : Math.min(Math.max(CFG.updatePeriod, nf - CFG.fifoLen), nf);
  if (popped) {
    const fifoP = probs.slice(nCache, nCache + nf);
    const storedP = compressed ? cacheP.slice(0, nCache) : probs.slice(0, nCache);
    let ce = [...cacheE, ...fifoE.slice(0, popped)], cp = [...storedP, ...fifoP.slice(0, popped)];
    if (ce.length > CFG.cacheLen) { [ce, cp] = compress(ce, cp); compressed = true; }
    cacheE = ce; cacheP = cp;
    fifo = fifoE.slice(popped);
  } else fifo = fifoE;
}

// ---------- offline chunk loop (reference forward, neither cache nor look-ahead given) ----------
const logitsOut = new Float32Array(T * SUB * K); let outPos = 0;
const dump = opt('--dump') ? [] : null;
let steps = 0; const tLoop = performance.now();
for (let start = 0; start < T; start += CFG.chunkLen) {
  const end = Math.min(start + CFG.chunkLen, T), nChunk = end - start;
  const chunkRows = []; for (let i = start; i < Math.min(end + CFG.rightContext, T); i++) chunkRows.push(row(i));
  const cached = [...cacheE, ...fifo];
  const input = [...cached, ...chunkRows];
  const data = new Float32Array(input.length * H); input.forEach((r, i) => data.set(r, i * H));
  const lg = (await stepS.run({ embeds: new ort.Tensor('float32', data, [1, input.length, H]) })).logits.data;
  if (dump) dump.push({ cached: cached.length, chunk: nChunk, inputRows: input.length, input: Array.from(data), logits: Array.from(lg) });
  update(input, lg, nChunk);
  const a = cached.length * SUB * K, b = (cached.length + nChunk) * SUB * K;
  logitsOut.set(lg.subarray(a, b), outPos); outPos += b - a;
  steps++;
}
if (dump) writeFileSync(opt('--dump'), JSON.stringify({ T, steps: dump }));
const tEnd = performance.now();

// ---------- segments (extract_speaker_dict: sigmoid > 0.5, 10 ms frames, no other post-processing) ----------
const segs = [];
for (let k = 0; k < K; k++) {
  let s0 = -1;
  for (let f = 0; f <= numFrames; f++) {
    const on = f < numFrames && logitsOut[f * K + k] > 0; // sigmoid(x) > 0.5  <=>  x > 0
    if (on && s0 < 0) s0 = f; else if (!on && s0 >= 0) { segs.push({ start: +(s0 * 0.01).toFixed(2), end: +(f * 0.01).toFixed(2), speaker: `S${k}` }); s0 = -1; }
  }
}
segs.sort((a, b) => a.start - b.start || a.speaker.localeCompare(b.speaker));
const ru = process.resourceUsage();
const run = { engine: 'Nemotron-3-Diarization (NealCaren ONNX step_int8) offline', engineHash: 'nemotron3-int8-1f18a5aed490', steps,
  timing: { featuresS: +((tFeat - t0) / 1000).toFixed(1), inferenceS: +((tEnd - tLoop) / 1000).toFixed(1), totalS: +((tEnd - t0) / 1000).toFixed(1) },
  cpuS: +((ru.userCPUTime + ru.systemCPUTime) / 1e6).toFixed(1), peakRssMB: Math.round(ru.maxRSS / 1024) };
writeFileSync(outF + '.tmp', JSON.stringify({ label: audioF.split(/[\\/]/).pop(), duration: +(audio.length / SR).toFixed(1), chosenSpeakers: 'auto', elapsedS: run.timing.totalS, smoothing: null, run, segments: segs }));
renameSync(outF + '.tmp', outF);
console.log(`${(audio.length / SR / 60).toFixed(1)} min audio, ${steps} steps, ${new Set(segs.map((s) => s.speaker)).size} speakers, ${run.timing.totalS} s total (${run.cpuS} s CPU), peak ${run.peakRssMB} MB`);
