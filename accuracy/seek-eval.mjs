// Sentence-click playback measured against human word times: for every sentence of the transcript lines, where would
// playback start, and does that moment fall in the gap before the sentence's first word?
//
//   node accuracy/seek-eval.mjs <audio> <reference.words.json> <turns-run.json> [--methods current,tiny,ctc] [--max N] [--json out]
//        [--only i,j]   just those lines, with their aligned word times printed
//
// reference: human words [{ w, s, e, speaker }] (AMI, accuracy/ami-words.mjs). turns-run: accuracy/pipeline-compare.mjs
// --design turns output (its `lines` are what the app shows). A sentence is scored only when its first word is found in
// the reference (spelling match near the line), so its true start is known.
// Methods:
//   current  the app today (src/lib/breath.js): a paragraph's first sentence from the turn's start + the breath before
//            it; later sentences from whisper-tiny.en word times on an 8 kHz copy (as src/lib/sentence-timing.js).
//   tiny     the same word times, used for EVERY sentence (first ones too), seeking just before the first word and never
//            into the previous word (src/lib/seek.js).
//   ctc      word times from forced alignment of the line's own text (wav2vec2, src/lib/ctc-align.js alignParagraph, as
//            the app), same rule.
//   est      a paragraph not word-timed yet (src/lib/sentence-timing.js startOf): its first sentence at the paragraph's own
//            start, later ones from the loudness envelope's estimate (lib/breath.js sentenceStarts).
//   ctcw     ctc, with the audio before the first word allowed to be any speech (ctc-align.js lead: 'wildcard').
//   ctcg     ctcw, and the gaps between words may hold speech the text leaves out (lead and gaps 'wildcard'; ctcg2: costlier).
//   ctc0     the same, but the previous line's context words are always kept (no take-over check; before 2026-10-30).
// A click is: good (in the gap before the first word, at most 0.45 s early, at most 0.08 s late), previous (0.08 s or
// more of the speech before is heard), preroll (only silence before it, but more than 0.45 s), or late (clips the word
// by more than 0.08 s).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [audioPath, refPath, runPath] = args;
const methods = opt('--methods', 'current,tiny,ctc').split(',');
const maxLines = Number(opt('--max', 0)) || Infinity;
const only = opt('--only') ? opt('--only').split(',').map(Number) : null; // just these lines, with their word times printed
const SR = 16000;

const { envelopeFromSamples, paragraphStart, sentenceStarts, sentenceStartsTimed, splitSentences } = await import(pathToFileURL(resolve(ROOT, 'src/lib/breath.js')).href);
const { alignWords } = await import(pathToFileURL(resolve(ROOT, 'src/lib/align-words.js')).href);
const { alignParagraph, refineStarts, ALIGN_SETTINGS, ONSET_SETTINGS } = await import(pathToFileURL(resolve(ROOT, 'src/lib/ctc-align.js')).href);
const { seekToSentence, sentenceAnchor, quietPoint } = await import(pathToFileURL(resolve(ROOT, 'src/lib/seek.js')).href);

function readWav(path) {
  const b = readFileSync(path);
  let p = 12;
  while (p < b.length) {
    const id = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === 'data') { const n = size / 2, out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = b.readInt16LE(p + 8 + i * 2) / 32768; return out; }
    p += 8 + size;
  }
  throw new Error('no data chunk');
}
const audio = readWav(audioPath);
const ref = JSON.parse(readFileSync(refPath, 'utf8')).sort((a, b) => a.s - b.s);
const run = JSON.parse(readFileSync(runPath, 'utf8'));
const lines = run.lines.map((l, i) => ({ ...l, id: i }));
const env = envelopeFromSamples(audio);

// the app's 8 kHz copy and its linear upsampling (src/lib/sentence-timing.js)
const LOW = 8000;
const low = new Int16Array(Math.floor(audio.length / 2));
for (let i = 0; i < low.length; i++) low[i] = Math.max(-32768, Math.min(32767, Math.round(((audio[2 * i] + audio[2 * i + 1]) / 2) * 32767)));
function appClip(seg) {
  const a = Math.max(0, Math.floor((seg.start - 0.3) * LOW)), b = Math.min(low.length, Math.ceil((seg.end + 0.2) * LOW));
  const out = new Float32Array((b - a) * 2);
  for (let i = a; i < b; i++) { const v0 = low[i] / 32768, v1 = (i + 1 < b ? low[i + 1] : low[i]) / 32768; out[(i - a) * 2] = v0; out[(i - a) * 2 + 1] = (v0 + v1) / 2; }
  return { audio: out, offset: a / LOW };
}

const T = await import('@huggingface/transformers');
T.env.allowRemoteModels = false;
const tiny = methods.some((m) => m === 'current' || m === 'tiny' || m === 'start0') ? await T.pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en_timestamped', { device: 'cpu', dtype: 'q8' }) : null;
let w2v = null, w2vProc = null, vocab = null;
if (methods.some((m) => m.startsWith('ctc') || m === 'app')) {
  w2vProc = await T.AutoProcessor.from_pretrained('Xenova/wav2vec2-base-960h');
  w2v = await T.AutoModelForCTC.from_pretrained('Xenova/wav2vec2-base-960h', { dtype: process.env.W2V_DTYPE || 'q8' }) // W2V_DTYPE=fp32: the uncompressed model, for comparison;
  const tok = await T.AutoTokenizer.from_pretrained('Xenova/wav2vec2-base-960h');
  const v = tok.get_vocab();
  vocab = v instanceof Map ? Object.fromEntries(v) : v;
}
const tinyWords = async (seg) => {
  const { audio: clip, offset } = appClip(seg);
  // capped: uncapped (as in production's align-worker) whisper-tiny never finished TS3004c line 799; the cap is
  // generous to production, where that paragraph would leave the timing worker busy for good
  const r = await tiny(clip, { return_timestamps: 'word', max_new_tokens: Math.min(440, 4 * String(seg.text).split(/\s+/).length + 32) });
  return (r.chunks || []).filter((c) => c.text.trim()).map((c) => [c.text.trim(), +(c.timestamp[0] + offset).toFixed(2), +((c.timestamp[1] ?? c.timestamp[0]) + offset).toFixed(2)]);
};
// the timing model's letter log-probabilities for a clip, per 20 ms frame. SEEK_CACHE=<dir>: kept there per clip (and
// model), so alignment rules can be compared again without running the model
const CACHE = process.env.SEEK_CACHE ? resolve(process.env.SEEK_CACHE, `${audioPath.split(/[\\/]/).pop()}-${process.env.W2V_DTYPE || 'q8'}`) : null;
if (CACHE) mkdirSync(CACHE, { recursive: true });
async function logProbsOf(pcm, key) {
  const file = CACHE && resolve(CACHE, `${key}.f32`);
  const V = 32;
  if (file && existsSync(file)) { const b = readFileSync(file); const lp = new Float32Array(b.buffer, b.byteOffset, b.length / 4); return { lp, frames: lp.length / V }; }
  const { logits } = await w2v(await w2vProc(pcm));
  const [, frames, LV] = logits.dims;
  if (LV !== V) throw new Error(`vocabulary size ${LV}`);
  const lp = new Float32Array(frames * V);
  for (let t = 0; t < frames; t++) {
    let mx = -Infinity; for (let v = 0; v < V; v++) mx = Math.max(mx, logits.data[t * V + v]);
    let sum = 0; for (let v = 0; v < V; v++) sum += Math.exp(logits.data[t * V + v] - mx);
    const lse = mx + Math.log(sum);
    for (let v = 0; v < V; v++) lp[t * V + v] = logits.data[t * V + v] - lse;
  }
  if (file) writeFileSync(file, Buffer.from(lp.buffer));
  return { lp, frames };
}
// ctcp<alpha> methods: the model's letter probabilities divided by its average ones (label prior) to the power alpha
// before alignment, so letters are not squeezed into a single frame at the end of a word ("peaky" timing)
const ONSET = process.env.ONSET_SCORE ? (() => { const b = readFileSync(process.env.ONSET_SCORE); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); })() : null;
const LOG_PRIOR = process.env.PRIOR_FILE ? JSON.parse(readFileSync(process.env.PRIOR_FILE, 'utf8')) : null;
function withPrior(lp, alpha) {
  if (!LOG_PRIOR) throw new Error('ctcp needs PRIOR_FILE');
  const V = LOG_PRIOR.length, out = new Float32Array(lp.length);
  for (let i = 0; i < lp.length; i++) out[i] = lp[i] - alpha * LOG_PRIOR[i % V];
  return out;
}
// app: exactly what the app's timing worker does (src/align-worker.js): the half-precision model with its layer-8
// hidden output appended (lib/onnx-output.js), forced alignment as ctc, then the word-onset head (ONSET_HEAD = weights
// file, lib/onset-head.js) on that clip's own hidden features and refineStarts with the app's settings
const HIDDEN = '/wav2vec2/encoder/layers.8/final_layer_norm/Add_1_output_0';
let appSession = null, appHead = null;
async function appWords(seg, words, prevLine) {
  if (!appSession) {
    const ort = await import('onnxruntime-node');
    const { withExtraOutput } = await import(pathToFileURL(resolve(ROOT, 'src/lib/onnx-output.js')).href);
    const { loadOnsetHead } = await import(pathToFileURL(resolve(ROOT, 'src/lib/onset-head.js')).href);
    const file = resolve(ROOT, 'node_modules/@huggingface/transformers/.cache/Xenova/wav2vec2-base-960h/onnx/model_fp16.onnx');
    appSession = { ort, s: await ort.InferenceSession.create(withExtraOutput(readFileSync(file), HIDDEN, 10)) };
    const hb = readFileSync(process.env.ONSET_HEAD); appHead = loadOnsetHead(hb.buffer.slice(hb.byteOffset, hb.byteOffset + hb.length));
  }
  const { onsetScores } = await import(pathToFileURL(resolve(ROOT, 'src/lib/onset-head.js')).href);
  const ctx = prevLine && seg.start - prevLine.end < 1.0 ? prevLine.text.trim().split(/\s+/).filter(Boolean).slice(-3) : [];
  const from = ctx.length ? Math.min(seg.start - 0.3, prevLine.end - 1.5) : seg.start - 0.3;
  const a = Math.max(0, Math.floor(from * SR)), b = Math.min(audio.length, Math.ceil((seg.end + 0.2) * SR));
  const { input_values } = await w2vProc(audio.slice(a, b));
  const out = await appSession.s.run({ input_values: new appSession.ort.Tensor('float32', input_values.data, input_values.dims) });
  const [, frames, V] = out.logits.dims;
  const lg = out.logits.data, lp = new Float32Array(frames * V);
  for (let t = 0; t < frames; t++) {
    let mx = -Infinity; for (let v = 0; v < V; v++) mx = Math.max(mx, lg[t * V + v]);
    let sum = 0; for (let v = 0; v < V; v++) sum += Math.exp(lg[t * V + v] - mx);
    const lse = mx + Math.log(sum);
    for (let v = 0; v < V; v++) lp[t * V + v] = lg[t * V + v] - lse;
  }
  const r = alignParagraph(lp, frames, vocab, ctx, words, seg.start - a / SR, ALIGN_SETTINGS);
  const ws = refineStarts(r.words, onsetScores(appHead, out[HIDDEN].data, frames), 0, ONSET_SETTINGS);
  return { words: ws.map((x) => (x ? [x.w, +(x.s + a / SR).toFixed(3), +(x.e + a / SR).toFixed(3)] : null)), prevEnd: r.prevEnd == null ? -Infinity : r.prevEnd + a / SR };
}
// forced alignment of the line's words, with the previous line's last words (if it ended just before) aligned first as
// context: then the end of the previous speech is placed too, instead of being blamed on this line's first word
const ctcWords = async (seg, words, prevLine, eight = false, takeover = true, lead = 'blank', wildcardLogP, gaps = 'blank', { alpha = 0 } = {}) => {
  const ctx = prevLine && seg.start - prevLine.end < 1.0 ? prevLine.text.trim().split(/\s+/).filter(Boolean).slice(-3) : [];
  const from = ctx.length ? Math.min(seg.start - 0.3, prevLine.end - 1.5) : seg.start - 0.3;
  const a = Math.max(0, Math.floor(from * SR)), b = Math.min(audio.length, Math.ceil((seg.end + 0.2) * SR));
  let pcm = audio.slice(a, b);
  if (eight) { const c = appClip({ start: a / SR + 0.3, end: b / SR - 0.2 }); pcm = c.audio.slice(0, b - a); } // the app's 8 kHz copy, linearly upsampled
  let { lp, frames } = await logProbsOf(pcm, `${a}-${b}${eight ? '-8k' : ''}`);
  if (alpha) lp = withPrior(lp, alpha);
  // the app's code (src/lib/ctc-align.js alignParagraph); takeover = false: the context is always kept (before 2026-10-30)
  const r = alignParagraph(lp, frames, vocab, ctx, words, takeover ? seg.start - a / SR : null, { lead, gaps, wildcardLogP });
  return { words: r.words.map((x) => (x ? [x.w, +(x.s + a / SR).toFixed(3), +(x.e + a / SR).toFixed(3)] : null)), prevEnd: r.prevEnd == null ? -Infinity : r.prevEnd + a / SR, alone: !!r.alone };
};

const norm = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
const FILLERS = new Set(['um', 'uh', 'uhm', 'mm', 'mmm', 'hmm', 'mm-hmm', 'mmhmm', 'er', 'erm', 'ah', 'oh']);
const results = Object.fromEntries(methods.map((m) => [m, []]));
let considered = 0;
for (const seg of lines.slice(0, maxLines)) {
  const i = seg.id;
  if (only && !only.includes(i)) continue;
  const parts = splitSentences(seg.text);
  const lineWords = parts.flatMap((p) => p.text.trim().split(/\s+/).filter(Boolean));
  // reference words near the line, and the true start of each sentence (its first word, if found)
  const near = ref.filter((r) => r.s >= seg.start - 1.5 && r.s <= seg.end + 1.5);
  const map = alignWords(lineWords, near.map((r) => ({ w: r.w })));
  let w = 0;
  const truth = parts.map((p) => {
    const n = p.text.trim().split(/\s+/).filter(Boolean).length;
    const j = map[w]; const first = lineWords[w]; w += n;
    if (j < 0 || norm(near[j].w) !== norm(first)) return null;
    const onset = near[j].s;
    const prev = ref.filter((r) => r.e <= onset + 0.05 && r.s < onset && r !== near[j]).reduce((m, r) => (m && m.e > r.e ? m : r), null);
    // for sorting failures: someone else talking at the sentence's start; the speech before by the same person; and
    // whether the transcript's sentence opens with what was said (its first words against the reference's)
    const who = near[j].speaker;
    const overlap = ref.some((r) => r.speaker !== who && r.s < onset + 0.05 && r.e > onset - 0.1);
    // (AMI writes apostrophes as &#39;; fillers like "um" are left out of transcripts)
    const plain = (w) => norm(String(w).replace(/&#39;/g, "'"));
    const said = ref.filter((r) => r.s >= onset - 0.01 && r.speaker === who).map((r) => plain(r.w)).filter((w) => w && !FILLERS.has(w)).slice(0, 3);
    const shown = p.text.trim().split(/\s+/).map(plain).filter((w) => w && !FILLERS.has(w)).slice(0, 3);
    const textOk = shown.filter((x, ii) => x === said[ii]).length >= Math.min(2, shown.length);
    return { onset, prevEnd: prev ? prev.e : -Infinity, word: first, overlap, prevSame: prev ? prev.speaker === who : null, textOk };
  });
  if (!truth.some(Boolean)) continue;
  considered++;
  if (process.env.SEEK_PROGRESS) console.error(new Date().toISOString(), 'line', i, (seg.end - seg.start).toFixed(1) + 's');
  const tw =methods.some((m) => m === 'current' || m === 'tiny' || m === 'start0') ? await tinyWords(seg) : null;
  const cwp = {};
  if (methods.includes('app')) cwp.app = await appWords(seg, lineWords, lines[i - 1]);
  const cw = methods.some((m) => m === 'ctc' || m.startsWith('ctco')) ? await ctcWords(seg, lineWords, lines[i - 1]) : null;
  // ctco[L<lead>][B<back>][M<min logit>][S<slack>][H<ahead>][A = strongest onset, not the latest]: ctc's word starts moved by the word-onset score (ONSET_SCORE: one logit per 20 ms of the
  // whole recording, src/lib/ctc-align.js refineStarts), then the same seek rule with that lead-in
  for (const m of methods.filter((x) => x.startsWith('ctco'))) {
    const back = +(m.match(/B([\d.]+)/)?.[1] ?? 0.6), min = +(m.match(/M(-?[\d.]+)/)?.[1] ?? 0), pick = m.includes('A') ? 'max' : 'last', slack = +(m.match(/S([\d.]+)/)?.[1] ?? 0.02), ahead = +(m.match(/H(-?[\d.]+)/)?.[1] ?? 0.06);
    // G<logp>: the base alignment lets the audio before the first word and the gaps between words hold speech the
    // text leaves out (wildcard, costing log(<p>) per frame against the likeliest letter); W<logp>: only before it
    const g = m.match(/([GW])([\d.]+)/);
    const base = g ? await ctcWords(seg, lineWords, lines[i - 1], false, true, 'wildcard', Math.log(+g[2]), g[1] === 'G' ? 'wildcard' : 'blank') : cw;
    const ws = base.words.map((x) => x && { w: x[0], s: x[1], e: x[2] });
    cwp[m] = { words: refineStarts(ws, ONSET, 0, { back, min, pick, slack, ahead }).map((x) => x && [x.w, x.s, x.e]), prevEnd: base.prevEnd, lead: +(m.match(/L([\d.]+)/)?.[1] ?? 0.05) };
  }
  if (only && cw) console.log(i, JSON.stringify(seg.text), 'prev:', JSON.stringify(lines[i - 1]?.text.slice(-60)), lines[i - 1]?.end, '\n  ctc:', cw.words.map((x) => (x ? x.join('@') : 'null')).join(' '), 'prevEnd', cw.prevEnd, '\n  truth:', JSON.stringify(truth));
  const cww = methods.includes('ctcw') ? await ctcWords(seg, lineWords, lines[i - 1], false, true, 'wildcard') : null;
  const cww2 = methods.includes('ctcw2') ? await ctcWords(seg, lineWords, lines[i - 1], false, true, 'wildcard', Math.log(0.01)) : null;
  const cwg = methods.includes('ctcg') ? await ctcWords(seg, lineWords, lines[i - 1], false, true, 'wildcard', Math.log(0.1), 'wildcard') : null;
  const cwg2 = methods.includes('ctcg2') ? await ctcWords(seg, lineWords, lines[i - 1], false, true, 'wildcard', Math.log(0.01), 'wildcard') : null;
  const cw0 = methods.includes('ctc0') ? await ctcWords(seg, lineWords, lines[i - 1], false, false) : null;
  const cw8 = methods.includes('ctc8') ? await ctcWords(seg, lineWords, lines[i - 1], true) : null;
  for (const m of methods.filter((x) => /^ctcp[\d.]+$/.test(x))) cwp[m] = await ctcWords(seg, lineWords, lines[i - 1], false, true, 'blank', undefined, 'blank', { alpha: +m.slice(4) });
  const prevLineEnd = lines[i - 1]?.end ?? -Infinity;
  for (const m of methods) {
    let starts;
    if (m === 'est') starts = parts.map((p, k) => (k === 0 || parts.length === 1 ? Math.max(0, seg.start) : sentenceStarts(lines, i, env, { text: seg.text })[k]));
    else if (m === 'start0') starts = parts.map((p, k) => (k === 0 ? seg.start : (parts.length > 1 ? sentenceStartsTimed(lines, i, env, tw, { text: seg.text })[k] : seg.start)));
    else if (m === 'ctcw') starts = parts.map((p, k) => seekToSentence({ text: seg.text, k, words: cww.words.filter(Boolean), prevEnd: cww.prevEnd }));
    else if (m === 'ctcw2') starts = parts.map((p, k) => seekToSentence({ text: seg.text, k, words: cww2.words.filter(Boolean), prevEnd: cww2.prevEnd }));
    else if (m === 'ctcg' || m === 'ctcg2') { const c = m === 'ctcg' ? cwg : cwg2; starts = parts.map((p, k) => seekToSentence({ text: seg.text, k, words: c.words.filter(Boolean), prevEnd: c.prevEnd })); }
    else if (m === 'ctc0') starts = parts.map((p, k) => seekToSentence({ text: seg.text, k, words: cw0.words.filter(Boolean), prevEnd: cw0.prevEnd }));
    else if (cwp[m]) starts = parts.map((p, k) => seekToSentence({ text: seg.text, k, words: cwp[m].words.filter(Boolean), prevEnd: cwp[m].prevEnd, lead: cwp[m].lead }));
    else if (m === 'ctc8') starts = parts.map((p, k) => seekToSentence({ text: seg.text, k, words: cw8.words.filter(Boolean), prevEnd: cw8.prevEnd }));
    else if (m === 'current') starts = parts.map((p, k) => (k === 0 ? paragraphStart(lines, i, env) : (parts.length > 1 ? sentenceStartsTimed(lines, i, env, tw, { text: seg.text })[k] : paragraphStart(lines, i, env))));
    else starts = parts.map((p, k) => seekToSentence({ text: seg.text, k, words: m === 'tiny' ? tw : cw.words.filter(Boolean), bias: m === 'tiny' ? 0.15 : 0, prevEnd: m === 'ctc' ? cw.prevEnd : -Infinity }));
    const cwM = cwp[m] ? cwp[m] : m === 'ctc' ? cw : m === 'ctc0' ? cw0 : m === 'ctcw' ? cww : m === 'ctcw2' ? cww2 : m === 'ctcg' ? cwg : m === 'ctcg2' ? cwg2 : null;
    const anchors = cwM ? parts.map((p, k) => sentenceAnchor({ text: seg.text, k, words: cwM.words.filter(Boolean), prevEnd: cwM.prevEnd })) : [];
    parts.forEach((p, k) => {
      const tr = truth[k];
      if (!tr || starts[k] == null) return;
      const t = starts[k], err = t - tr.onset;
      const intoPrev = tr.prevEnd - t; // > 0: this much of the previous speech is heard
      // previous: some of the speech before is heard; preroll: only silence before, but more than 0.45 s of it
      const verdict = err > 0.08 ? 'late' : intoPrev > 0.08 ? 'previous' : err < -0.45 ? 'preroll' : 'good';
      const a = anchors[k];
      results[m].push({ line: i, k, t: +t.toFixed(3), onset: tr.onset, err: +err.toFixed(3), intoPrev: +intoPrev.toFixed(3), verdict, first: k === 0,
        gap: +(tr.onset - tr.prevEnd).toFixed(3), overlap: tr.overlap, prevSame: tr.prevSame, textOk: tr.textOk,
        ...(a ? { ao: +a.onset.toFixed(3), skipped: a.skipped, floor: +a.floor.toFixed(3), pws: a.prev ? a.prev.s : null,
          q: +(quietPoint(audio, SR, Math.max(a.prev ? a.prev.s + 0.08 : -Infinity, a.onset - 0.35), a.onset + 0.06) ?? a.onset).toFixed(3) } : {}) });
    });
  }
}
const summary = {};
for (const m of methods) {
  const r = results[m], n = r.length || 1;
  const pct = (f) => +(100 * r.filter(f).length / n).toFixed(1);
  const errs = r.map((x) => Math.abs(x.err)).sort((a, b) => a - b);
  const f = r.filter((x) => x.first), nf = Math.max(1, f.length);
  summary[m] = { clicks: r.length, good: pct((x) => x.verdict === 'good'), previous: pct((x) => x.verdict === 'previous'), preroll: pct((x) => x.verdict === 'preroll'), late: pct((x) => x.verdict === 'late'),
    firstSentences: { clicks: f.length, good: +(100 * f.filter((x) => x.verdict === 'good').length / nf).toFixed(1), previous: +(100 * f.filter((x) => x.verdict === 'previous').length / nf).toFixed(1) },
    medianAbsErr: errs.length ? +errs[errs.length >> 1].toFixed(3) : null };
}
const out = { audio: audioPath.split(/[\\/]/).pop(), lines: considered, summary };
if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify({ ...out, results }));
console.log(JSON.stringify(out));
