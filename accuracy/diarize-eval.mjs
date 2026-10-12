// Speaker-detection ("who spoke when") test runner. Runs the app's own diarization code
// (src/engine/diarize.js) in Node with the same models, on CPU, and scores it.
//
//   node accuracy/diarize-eval.mjs <audio> [--speakers N] [--rttm ref.rttm] [--json out.json] [--label name]
//
// With an RTTM reference (e.g. the AMI meetings in accuracy/testset/ami) it reports:
//   speaker count, missed / false-alarm / confusion time (DER-style), Unknown time,
//   false and missed speaker changes, and IDENTITY SWAPS: a real person's turns carried by a label that
//   belongs to someone else, or one person's label changing partway through the recording.
// Without a reference (a private recording) it reports a per-minute speaker timeline and a voice-consistency
// check: every turn's voice compared with every speaker's average voice, flagging turns that sound more like
// another speaker than the one they were given.
//
// Audio never leaves this machine. Everything is decoded with the app's bundled ffmpeg (wasm).
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { frames, hypRunsOf, summary, internalDiagnostics } from './lab/diagnostics.mjs';
import { standardMetrics, standardHypothesis, METRICS_VERSION } from './lab/metrics.mjs';
import { labExtras } from './lab/extras.mjs';
import { readRttm } from './lab/reference.mjs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!file) { console.error('usage: node accuracy/diarize-eval.mjs <audio> [--speakers N] [--rttm ref.rttm] [--json out.json]'); process.exit(1); }
const numSpeakers = Number(opt('--speakers', 0)) || 0;
const rttmPath = opt('--rttm');
const jsonOut = opt('--json');
const label = opt('--label', basename(file));
const quiet = args.includes('--quiet');

// ---------- decode (ffmpeg.wasm, like the app's fallback decoder) ----------
async function decode(path) {
  globalThis.self ??= globalThis;
  globalThis.location ??= { href: pathToFileURL(resolve(ROOT, 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js')).href };
  const dir = resolve(ROOT, 'node_modules/@ffmpeg/core/dist/esm');
  const { default: createFFmpegCore } = await import(pathToFileURL(resolve(dir, 'ffmpeg-core.js')).href);
  const core = await createFFmpegCore({ wasmBinary: readFileSync(resolve(dir, 'ffmpeg-core.wasm')), locateFile: (p) => resolve(dir, p) });
  const ext = path.split('.').pop();
  core.FS.writeFile(`in.${ext}`, readFileSync(path));
  core.exec('-i', `in.${ext}`, '-ac', '1', '-ar', '16000', '-f', 'f32le', 'out.raw');
  const raw = core.FS.readFile('out.raw');
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
}

// ---------- models (same ids and fp32 weights as the app on WebGPU; CPU here) ----------
const T = await import('@huggingface/transformers');
// machine safeguards (set by accuracy/diarize-run.mjs): never download models, cap the CPU threads a run may use
if (process.env.DIAR_OFFLINE) T.env.allowRemoteModels = false;
const threads = Number(process.env.DIAR_THREADS) || 0;
const sessionOpts = threads ? { session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 } } : {};
const { analyzeAudio, preprocess } = await import(pathToFileURL(resolve(ROOT, 'src/engine/preprocess.js')).href);
// --module lets an experiment run a modified copy of the diarization code against the same scoring
const modulePath = resolve(opt('--module') || resolve(ROOT, 'src/engine/diarize.js'));
const D = await import(pathToFileURL(modulePath).href);
// which speaker code produced a result (sha256 of the module file), so saved results can be matched to a commit
const engineHash = createHash('sha256').update(readFileSync(modulePath)).digest('hex');
if (opt('--rescore') && !D.UNKNOWN) throw new Error('bad module');
// --features overlap=0,segDiff=0 … switches refinements off (ablation)
for (const kv of (opt('--features') || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); if (D.FEATURES && k in D.FEATURES) D.FEATURES[k] = v !== '0'; }
const SEG_MODEL = 'onnx-community/pyannote-segmentation-3.0';
const EMB_MODEL = 'onnx-community/wespeaker-voxceleb-resnet34-LM';

const t0 = performance.now();
// --rescore old.json: score a saved run again (new metrics) without running speaker detection
const saved = opt('--rescore') ? JSON.parse(readFileSync(opt('--rescore'), 'utf8')) : null;
let audio = null, segments, stats, dur;
if (saved) ({ segments, smoothing: stats, duration: dur } = saved);
else {
  audio = await decode(resolve(file));
  const quality = analyzeAudio(audio);
  preprocess(audio, quality);
  const segProcessor = await T.AutoProcessor.from_pretrained(SEG_MODEL);
  const segModel = await T.AutoModelForAudioFrameClassification.from_pretrained(SEG_MODEL, { device: 'cpu', dtype: 'fp32', ...sessionOpts });
  const embProcessor = await T.AutoProcessor.from_pretrained(EMB_MODEL);
  const embModel = await T.AutoModel.from_pretrained(EMB_MODEL, { device: 'cpu', dtype: 'fp32', ...sessionOpts });
  const timings = [];
  D.configureDiarizer({
    segModel, segProcessor, segDevice: 'cpu', embModel, embProcessor, embDevice: 'cpu', Tensor: T.Tensor,
    status: () => {}, lap: (l) => timings.push(l), post: () => {},
  });
  ({ segments, stats } = await D.diarize(audio, numSpeakers));
  dur = audio.length / D.SR;
}
const elapsed = (performance.now() - t0) / 1000;

// ---------- helpers ----------
const FR = 0.01; // 10 ms frames
const { nF, hypFrames } = frames(segments, dur);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const hypRuns = hypRunsOf(segments);
const report = { label, file: basename(file), duration: +dur.toFixed(1), chosenSpeakers: numSpeakers || 'auto', elapsedS: +elapsed.toFixed(1),
  ...summary(segments, dur, D.UNKNOWN), smoothing: stats };

// ---------- scored against a reference ----------
// standard = pyannote.metrics semantics (accuracy/lab/metrics.mjs, cross-checked); lab = exact-time diagnostics on
// the standard mapping; the remaining top-level fields are SparkScribe's internal diagnostics (frame-based, kept as
// they were so older results stay comparable)
if (rttmPath) {
  const ref = readRttm(readFileSync(rttmPath, 'utf8'));
  const hyp = standardHypothesis(segments, D.UNKNOWN);
  Object.assign(report, internalDiagnostics(segments, ref.map((r) => ({ start: r.start, end: r.end, speaker: r.label })), dur, D.UNKNOWN),
    { metricsVersion: METRICS_VERSION, standard: standardMetrics(ref, hyp), lab: labExtras(segments, ref, hyp, D.UNKNOWN) });
  if (segments.some((s) => s.voices)) report.standardNamedOverlap = standardMetrics(ref, standardHypothesis(segments, D.UNKNOWN, { namedOverlap: true }));
} else {
  const runs = hypRuns.filter((r) => r.speaker !== D.UNKNOWN && r.end - r.start >= 2);
  const embs = audio ? await D.embedClips(audio, runs.map((r) => [{ start: r.start, end: r.end }])) : runs.map(() => new Float32Array(256)); // rescored runs skip the voice check
  const cent = new Map();
  runs.forEach((r, i) => { const c = cent.get(r.speaker) || new Float32Array(embs[i].length); for (let d = 0; d < c.length; d++) c[d] += embs[i][d] * (r.end - r.start); cent.set(r.speaker, c); });
  for (const [k, c] of cent) { let n = 0; for (const v of c) n += v * v; n = Math.sqrt(n) || 1; cent.set(k, c.map((v) => v / n)); }
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  const suspicious = [];
  runs.forEach((r, i) => {
    const own = dot(embs[i], cent.get(r.speaker));
    let other = null, os = -1;
    for (const [k, c] of cent) if (k !== r.speaker) { const v = dot(embs[i], c); if (v > os) { os = v; other = k; } }
    if (other && os > own) suspicious.push({ at: fmt(r.start), len: +(r.end - r.start).toFixed(1), given: r.speaker, soundsLike: other, own: +own.toFixed(2), other: +os.toFixed(2) });
  });
  const perMinute = [];
  for (let m = 0; m < Math.ceil(dur / 60); m++) {
    const row = {};
    for (let f = Math.floor(m * 60 / FR); f < Math.min(nF, Math.floor((m + 1) * 60 / FR)); f++) for (const h of hypFrames[f]) row[h] = (row[h] || 0) + FR;
    perMinute.push(`${String(m).padStart(2, '0')}: ` + Object.entries(row).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(0)}s`).join(', '));
  }
  Object.assign(report, { turnsChecked: runs.length, turnsSoundingLikeAnotherSpeaker: suspicious.length,
    suspiciousTurns: suspicious.slice(0, 40), perMinute,
    runs: hypRuns.map((r) => `${fmt(r.start)}-${fmt(r.end)} ${r.speaker}`) });
}

if (!quiet) {
  const { runs, perMinute, suspiciousTurns, swapExamples, ...head } = report;
  console.log(JSON.stringify(head, null, 2));
  if (swapExamples?.length) console.log('identity changes:', JSON.stringify(swapExamples));
  if (perMinute) console.log(perMinute.join('\n'));
  if (suspiciousTurns?.length) console.log('turns that sound like another speaker:\n' + suspiciousTurns.map((s) => `  ${s.at} (${s.len}s) given ${s.given}, sounds like ${s.soundsLike} (${s.own} vs ${s.other})`).join('\n'));
}
if (jsonOut) {
  const ru = process.resourceUsage();
  const run = saved ? saved.run : { engineHash, runKey: opt('--features') ? `${engineHash}+${opt('--features')}` : engineHash, features: D.FEATURES ? { ...D.FEATURES } : null, threads: threads || null, peakRssMB: Math.round(ru.maxRSS / 1024), cpuS: +((ru.userCPUTime + ru.systemCPUTime) / 1e6).toFixed(1) };
  // written to a temp name first, so an interrupted run never leaves a half-written result behind
  writeFileSync(jsonOut + '.tmp', JSON.stringify({ ...report, run, segments }, null, 1));
  renameSync(jsonOut + '.tmp', jsonOut);
}
