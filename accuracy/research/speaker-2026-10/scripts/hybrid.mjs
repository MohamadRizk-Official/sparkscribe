// v1 + Nemotron hybrid feasibility on SAVED predictions only (see PROTOCOL.md). No model runs, no audio.
//   node hybrid.mjs dev        analyses 1-4 + strategy grid on development data; freezes chosen.json
//   node hybrid.mjs heldout    applies the frozen choice to IS1009c / EN2002d (once) + descriptive analyses
//   node hybrid.mjs coffee     writes the frozen hybrid's output on the user's recording (scored by coffee-eval.cjs)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const REPO = 'C:/Users/wael2/Downloads/neuralscribe';
const S = 'C:/Users/wael2/AppData/Local/Temp/claude/C--Users-wael2-Downloads-neuralscribe/54ead60f-839e-4688-9326-f3fa68f8d2be/scratchpad';
const H = `${S}/hybrid`;
const lab = (f) => import(pathToFileURL(`${REPO}/accuracy/lab/${f}`).href);
const { standardMetrics, standardHypothesis, hungarianMax } = await lab('metrics.mjs');
const { labExtras } = await lab('extras.mjs');
const { internalDiagnostics } = await lab('diagnostics.mjs');
const { readRttm } = await lab('reference.mjs');
const J = (f) => JSON.parse(readFileSync(f, 'utf8'));
const A = `${REPO}/accuracy/testset/ami`, T = `${REPO}/accuracy/testset/diar-scenarios`;

const DEV_AMI = ['ES2004a', 'IS1009a', 'TS3003a', 'EN2002b', 'ES2004a-far'];
const DEV_SYN = ['two-short-interruptions', 'one-speaker-everything', 'similar-voices', 'five-speakers'];
const HELD = ['IS1009c', 'EN2002d'];
const rec = (n) => ({
  name: n,
  v1: HELD.includes(n) ? `${S}/nemotron/v1runs/${n}-auto-v1.json` : `${S}/rs/${n}-auto-v1.json`,
  nem: `${S}/nemotron/runs/${n}-nemotron.json`,
  rttm: DEV_SYN.includes(n) ? `${T}/${n}.rttm` : `${A}/${n.replace('-far', '')}.rttm`,
  slide: ['ES2004a', 'IS1009a'].includes(n) ? `${S}/diar/slide/${n}-w1.5.json` : null,
});

// ---------------- frame grids (10 ms), one bit per label ----------------
const FR = 0.01;
const popc = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };
const bitIdx = (x) => 31 - Math.clz32(x);
function toMask(segs, idx, nF) {
  const m = new Uint32Array(nF);
  for (const s of segs) {
    if (s.overlap || s.speaker === 'Unknown') continue;
    const b = 1 << idx(s.speaker), f0 = Math.max(0, Math.round(s.start / FR)), f1 = Math.min(nF, Math.round(s.end / FR));
    for (let f = f0; f < f1; f++) m[f] |= b;
  }
  return m;
}
function toSegs(m, vocab) {
  const out = [];
  for (let b = 0; b < vocab.length; b++) {
    const bit = 1 << b; let st = -1;
    for (let f = 0; f <= m.length; f++) {
      const on = f < m.length && (m[f] & bit);
      if (on && st < 0) st = f; else if (!on && st >= 0) { out.push({ start: +(st * FR).toFixed(2), end: +(f * FR).toFixed(2), speaker: vocab[b] }); st = -1; }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
// runs of frames with exactly one label (same label, contiguous)
function singleRuns(m) {
  const out = []; let cur = null;
  for (let f = 0; f <= m.length; f++) {
    const x = f < m.length && popc(m[f]) === 1 ? m[f] : 0;
    if (cur && x === cur.bit) continue;
    if (cur) { cur.b = f; out.push(cur); cur = null; }
    if (x) cur = { a: f, b: f, bit: x };
  }
  return out;
}
const majority = (m, a, b) => { // single-label majority over [a,b) frames; null when no label covers half
  const c = new Map(); let n = 0;
  for (let f = Math.max(0, a); f < Math.min(m.length, b); f++) { n++; if (popc(m[f]) === 1) c.set(m[f], (c.get(m[f]) || 0) + 1); }
  let best = null, k = 0; for (const [x, v] of c) if (v > k) { best = x; k = v; }
  return best && k >= n / 2 ? best : null;
};

// ---------------- load + align one recording ----------------
function load(r) {
  const v1run = J(r.v1), nemRun = J(r.nem);
  const dur = Math.max(v1run.duration, nemRun.duration ?? 0);
  const nF = Math.ceil(dur / FR);
  const v1Labels = [...new Set(v1run.segments.filter((s) => s.speaker !== 'Unknown' && !s.overlap).map((s) => s.speaker))].sort();
  const nemLabels = [...new Set(nemRun.segments.map((s) => s.speaker))].sort();
  const v1m = toMask(v1run.segments, (l) => v1Labels.indexOf(l), nF);
  const nmRaw = toMask(nemRun.segments, (l) => nemLabels.indexOf(l), nF);
  // Nemotron -> v1 label mapping from the two outputs only (no answer key)
  const co = nemLabels.map(() => v1Labels.map(() => 0));
  for (let f = 0; f < nF; f++) if (popc(nmRaw[f]) === 1 && popc(v1m[f]) === 1) co[bitIdx(nmRaw[f])][bitIdx(v1m[f])]++;
  const map = new Map(); for (const [i, j] of hungarianMax(co)) if (co[i][j] > 0) map.set(i, j);
  const vocab = [...v1Labels]; const nemTo = nemLabels.map((l, i) => (map.has(i) ? map.get(i) : vocab.push(`N_${l}`) - 1));
  const nm = new Uint32Array(nF); for (let f = 0; f < nF; f++) { let x = nmRaw[f], y = 0; while (x) { const b = bitIdx(x); y |= 1 << nemTo[b]; x &= ~(1 << b); } nm[f] = y; }
  const ref = readRttm(readFileSync(r.rttm, 'utf8'));
  return { ...r, dur, nF, vocab, v1m, nm, ref, nemMap: Object.fromEntries(nemLabels.map((l, i) => [l, vocab[nemTo[i]]])) };
}

// ---------------- scoring (the repo's own lab functions) ----------------
function score(R, mask) {
  const segs = toSegs(mask, R.vocab);
  const hyp = standardHypothesis(segs, 'Unknown');
  const std = standardMetrics(R.ref, hyp), L = labExtras(segs, R.ref, hyp, 'Unknown');
  const diag = internalDiagnostics(segs, R.ref.map((x) => ({ start: x.start, end: x.end, speaker: x.label })), R.dur, 'Unknown');
  const su = L.shortUtterances; let own = 0, tot = 0, oth = 0;
  for (const b of ['0-0.5s', '0.5-1s']) for (const k of ['standalone', 'saidOver']) { own += su[b][k].own; tot += su[b][k].total; oth += su[b][k].otherPerson; }
  const single = L.singleSpeech.seconds;
  return { segs, std, lab: L, m: {
    der: std.der.der, jer: std.jer, missS: std.der.missed, faS: std.der.falseAlarm, confS: std.der.confusion, totS: std.der.total,
    singleS: single, rightS: single * L.singleSpeech.correctPersonPct / 100, wrongS: single * L.singleSpeech.wrongPersonPct / 100,
    noNameS: single * L.singleSpeech.noNamedLabelPct / 100,
    mc: L.changes['within0.5s'].missed, fc: L.changes['within0.5s'].false, refc: L.changes['within0.5s'].reference,
    mc1: L.changes['within1s'].missed, fc1: L.changes['within1s'].false,
    shortOwn: own, shortTot: tot, shortWrong: oth, swaps: diag.identitySwaps, spk: L.speakerCount.detected, refSpk: L.speakerCount.reference,
    splits: L.splits.length, merges: L.merges.length, dur: R.dur } };
}

// ---------------- strategies ----------------
const STRATS = { H0: (R) => R.v1m, H1: (R) => R.nm,
  H2: (R) => R.nm.map((x, f) => x || R.v1m[f]),
  H3: (R, { G }) => {
    const out = R.nm.slice(); const g = Math.round(G / FR);
    for (let f = 0; f < R.nF;) {
      if (R.nm[f]) { f++; continue; }
      let e = f; while (e < R.nF && !R.nm[e]) e++;
      if (e - f <= g) { const nb = (f > 0 ? R.nm[f - 1] : 0) | (e < R.nF ? R.nm[e] : 0); for (let q = f; q < e; q++) out[q] = R.v1m[q] & nb; }
      f = e;
    }
    return out;
  },
  H4: (R, { dmin, dmax, sandwich, fillGaps }) => {
    const out = R.v1m.slice(), nV1 = R.vocab.filter((l) => !l.startsWith('N_')).length, half = Math.round(0.5 / FR);
    for (const run of singleRuns(R.nm)) {
      const d = (run.b - run.a) * FR; if (d < dmin || d > dmax || bitIdx(run.bit) >= nV1) continue; // only v1 identities
      const M = majority(R.v1m, run.a, run.b); if (M === run.bit) continue;
      if (M == null && !fillGaps) continue;
      if (sandwich && (M == null || majority(R.v1m, run.a - half, run.a) !== M || majority(R.v1m, run.b, run.b + half) !== M)) continue;
      for (let f = run.a; f < run.b; f++) if (R.v1m[f] || fillGaps) out[f] = run.bit;
    }
    return out;
  } };
const GRID = [{ id: 'H2', s: 'H2', p: {} },
  ...[0.5, 1, 2, 5, Infinity].map((G) => ({ id: `H3(G=${G})`, s: 'H3', p: { G } })),
  ...[0, 0.3].flatMap((dmin) => [1, 2, 4, Infinity].flatMap((dmax) => [false, true].flatMap((sandwich) => [false, true].map((fillGaps) =>
    ({ id: `H4(${dmin}-${dmax}s${sandwich ? ',sandwich' : ''}${fillGaps ? ',fillGaps' : ''})`, s: 'H4', p: { dmin, dmax, sandwich, fillGaps } })))))];

// ---------------- analyses 1-3 ----------------
const turnsOf = (ref) => { const t = []; for (const r of [...ref].sort((a, b) => a.start - b.start)) { const l = t.findLast((x) => x.label === r.label); if (l && r.start - l.end < 0.3) l.end = Math.max(l.end, r.end); else t.push({ ...r }); } return t.sort((a, b) => a.start - b.start); };
const changesOf = (segs) => { // lab definition
  const hyp = standardHypothesis(segs, 'Unknown'), runs = [];
  for (const s of hyp) { const l = runs[runs.length - 1]; if (l && l.label === s.label && s.start - l.end < 0.5) l.end = Math.max(l.end, s.end); else runs.push({ ...s }); }
  const ch = []; for (let i = 1; i < runs.length; i++) if (runs[i].label !== runs[i - 1].label) ch.push({ t: runs[i].start, A: runs[i - 1].label, B: runs[i].label, prevDur: runs[i - 1].end - runs[i - 1].start, nextDur: runs[i].end - runs[i].start, gap: runs[i].start - runs[i - 1].end });
  return ch;
};
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
function changeAnalysis(R, nemScore) {
  const turns = turnsOf(R.ref), refCh = []; for (let i = 1; i < turns.length; i++) if (turns[i].label !== turns[i - 1].label) refCh.push({ t: turns[i].start, A: turns[i - 1].label, B: turns[i].label });
  const gt = nemScore.std.der.mapping; // measurement only
  const v1Ch = changesOf(toSegs(R.v1m, R.vocab)).map((c) => c.t);
  const idx = (l) => R.vocab.indexOf(l), s1 = Math.round(1 / FR);
  const slide = R.slide && existsSync(R.slide) ? J(R.slide) : null;
  return changesOf(toSegs(R.nm, R.vocab)).map((c) => {
    const near = refCh.filter((x) => Math.abs(x.t - c.t) <= 0.5).sort((p, q) => Math.abs(p.t - c.t) - Math.abs(q.t - c.t))[0];
    const f = Math.round(c.t / FR), bA = 1 << idx(c.A), bB = 1 << idx(c.B);
    const v1Before = majority(R.v1m, f - s1, f), v1After = majority(R.v1m, f, f + s1);
    let fp = null;
    if (slide && slide.cent[c.A] && slide.cent[c.B]) {
      const i = slide.pos.findIndex((p) => p.t >= c.t - 0.01 && p.t <= c.t + 0.5); // first 1.5 s window starting just after the change
      if (i >= 0) fp = dot(slide.emb[i], slide.cent[c.B]) - dot(slide.emb[i], slide.cent[c.A]);
    }
    return { ...c, correct: !!near, idCorrect: !!near && gt[c.A] === near.A && gt[c.B] === near.B,
      v1Near05: v1Ch.some((t) => Math.abs(t - c.t) <= 0.5), v1Near1: v1Ch.some((t) => Math.abs(t - c.t) <= 1),
      v1Sides: v1Before === bA && v1After === bB, v1After: v1After === bB, fp };
  });
}
function unnamedAnalysis(R, v1Score) {
  // reference single-speaker frames where Nemotron names nobody: what does v1 say there?
  const gt = v1Score.std.der.mapping, refLabels = [...new Set(R.ref.map((x) => x.label))];
  const rm = toMask(R.ref.map((x) => ({ start: x.start, end: x.end, speaker: x.label })), (l) => refLabels.indexOf(l), R.nF);
  const out = {}; const add = (k, o) => { out[k] ??= { right: 0, wrong: 0, none: 0 }; out[k][o] += FR; };
  for (let f = 0; f < R.nF;) {
    if (R.nm[f]) { f++; continue; }
    let e = f; while (e < R.nF && !R.nm[e]) e++;
    const prev = f > 0 ? R.nm[f - 1] : 0, next = e < R.nF ? R.nm[e] : 0, len = (e - f) * FR;
    const lb = len < 0.5 ? '<0.5s' : len < 1 ? '0.5-1s' : len < 2 ? '1-2s' : len < 5 ? '2-5s' : '>=5s';
    for (let q = f; q < e; q++) {
      if (popc(rm[q]) !== 1) continue;
      const truth = refLabels[bitIdx(rm[q])], v = R.v1m[q];
      const o = !v ? 'none' : [...R.vocab.keys()].some((b) => (v & (1 << b)) && gt[R.vocab[b]] === truth) ? 'right' : 'wrong';
      const ctx = !v ? 'v1 names nobody' : prev && prev === next && (v & prev) ? 'same Nemotron speaker both sides, v1 agrees'
        : (v & (prev | next)) ? 'v1 agrees with one neighbour' : 'v1 names a third person';
      add(ctx, o); add(`gap ${lb}`, o); add('all', o);
    }
    f = e;
  }
  for (const k in out) for (const o in out[k]) out[k][o] = +out[k][o].toFixed(1);
  return out;
}
const auc = (pos, neg) => { if (!pos.length || !neg.length) return null; let s = 0; for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0; return +(s / (pos.length * neg.length)).toFixed(3); };
function featureTable(chs) {
  const out = {};
  for (const [name, sub] of [['all Nemotron changes', chs], ['changes v1 lacks (no v1 change within ±1 s)', chs.filter((c) => !c.v1Near1)]]) {
    const ok = sub.filter((c) => c.correct), bad = sub.filter((c) => !c.correct);
    const row = { n: sub.length, correct: ok.length, idCorrect: sub.filter((c) => c.idCorrect).length, false: bad.length };
    for (const k of ['v1Near05', 'v1Near1', 'v1Sides', 'v1After']) { const t = sub.filter((c) => c[k]), f = sub.filter((c) => !c[k]); row[k] = { whenTrue: `${t.filter((c) => c.correct).length}/${t.length}`, whenFalse: `${f.filter((c) => c.correct).length}/${f.length}` }; }
    for (const k of ['prevDur', 'nextDur', 'gap', 'fp']) { const p = ok.map((c) => c[k]).filter((x) => x != null), q = bad.map((c) => c[k]).filter((x) => x != null); row[`auc_${k}`] = { auc: auc(p, q), n: p.length + q.length }; }
    const fp = sub.filter((c) => c.fp != null);
    if (fp.length) row.fpThresholds = [-0.1, 0, 0.05, 0.1, 0.2, 0.3].map((th) => { const k = fp.filter((c) => c.fp >= th); return { th, kept: k.length, correct: k.filter((c) => c.correct).length, idCorrect: k.filter((c) => c.idCorrect).length }; });
    out[name] = row;
  }
  return out;
}

// ---------------- pooling ----------------
const pool = (ms) => {
  const s = (k) => ms.reduce((a, m) => a + m[k], 0), w = s('dur');
  return { der: (s('missS') + s('faS') + s('confS')) / s('totS'), jer: ms.reduce((a, m) => a + m.jer * m.dur, 0) / w,
    wrongPct: 100 * s('wrongS') / s('singleS'), rightPct: 100 * s('rightS') / s('singleS'), noNamePct: 100 * s('noNameS') / s('singleS'),
    mc: s('mc'), fc: s('fc'), mc1: s('mc1'), fc1: s('fc1'), shortOwn: s('shortOwn'), shortTot: s('shortTot'), shortWrong: s('shortWrong'), swaps: s('swaps'), refc: s('refc') };
};
const fmt = (m) => ({ DER: +(100 * m.der).toFixed(2), JER: +(100 * m.jer).toFixed(2), right: +(m.rightPct ?? 100 * m.rightS / m.singleS).toFixed(2), wrong: +(m.wrongPct ?? 100 * m.wrongS / m.singleS).toFixed(2), noName: +(m.noNamePct ?? 100 * m.noNameS / m.singleS).toFixed(2),
  missedCh: m.mc, falseCh: m.fc, missedCh1s: m.mc1, falseCh1s: m.fc1, short: `${m.shortOwn}/${m.shortTot}`, shortWrong: m.shortWrong, swaps: m.swaps, ...(m.spk != null ? { spk: `${m.spk}/${m.refSpk}` } : {}) });

// ================================================================================================
const mode = process.argv[2];
if (mode === 'dev') {
  const recs = [...DEV_AMI, ...DEV_SYN].map((n) => load(rec(n)));
  const res = { analyses: {}, grid: {}, perRec: {} };
  const scores = new Map();
  for (const R of recs) {
    const s0 = score(R, STRATS.H0(R)), s1 = score(R, STRATS.H1(R));
    const orig = J(R.v1); // grid round-trip check against the original v1 scoring
    res.perRec[R.name] = { nemMap: R.nemMap, H0: fmt(s0.m), H1: fmt(s1.m), roundTripDERdiff: orig.standard ? +(100 * (s0.m.der - orig.standard.der.der)).toFixed(3) : null };
    scores.set(R.name, { H0: s0.m, H1: s1.m });
    if (DEV_AMI.includes(R.name)) { R.ch = changeAnalysis(R, s1); R.unnamed = unnamedAnalysis(R, s0); }
    for (const g of GRID) scores.get(R.name)[g.id] = score(R, STRATS[g.s](R, g.p)).m;
  }
  const ami = recs.filter((R) => DEV_AMI.includes(R.name));
  res.analyses.changes = featureTable(ami.flatMap((R) => R.ch));
  res.analyses.changesFingerprintRecs = featureTable(ami.filter((R) => R.slide).flatMap((R) => R.ch));
  res.analyses.unnamed = {}; for (const R of ami) for (const [k, v] of Object.entries(R.unnamed)) { res.analyses.unnamed[k] ??= { right: 0, wrong: 0, none: 0 }; for (const o in v) res.analyses.unnamed[k][o] = +(res.analyses.unnamed[k][o] + v[o]).toFixed(1); }
  const ids = ['H0', 'H1', ...GRID.map((g) => g.id)];
  const P = Object.fromEntries(ids.map((id) => [id, pool(DEV_AMI.map((n) => scores.get(n)[id]))]));
  const v = P.H0, qualifies = {};
  for (const id of ids.slice(2)) {
    const p = P[id], why = [];
    if (p.der > v.der) why.push('DER'); if (p.jer > v.jer) why.push('JER'); if (p.wrongPct > v.wrongPct) why.push('wrong-person');
    if (p.swaps > v.swaps) why.push('swaps'); if (p.fc > 1.10 * v.fc) why.push('false changes'); if (p.noNamePct > v.noNamePct + 1) why.push('unnamed');
    for (const n of DEV_SYN) if (scores.get(n)[id].der > scores.get(n).H0.der + 0.02) why.push(`DER ${n}`);
    qualifies[id] = why;
    res.grid[id] = { ...fmt(p), fails: why };
  }
  res.grid.H0 = fmt(P.H0); res.grid.H1 = fmt(P.H1);
  const ok = ids.slice(2).filter((id) => !qualifies[id].length).sort((a, b) => P[a].mc - P[b].mc || P[a].der - P[b].der);
  res.synthetic = Object.fromEntries(DEV_SYN.map((n) => [n, Object.fromEntries(['H0', 'H1', 'H2', 'H3(G=Infinity)'].map((id) => [id, fmt(scores.get(n)[id])]))]));
  const chosen = ok[0] ?? null;
  // closest-to-qualifying candidate (fewest failed conditions, then most missed changes recovered) - reported, never "chosen"
  const nearest = ids.slice(2).sort((a, b) => qualifies[a].length - qualifies[b].length || P[a].mc - P[b].mc)[0];
  res.selection = { qualified: ok, chosen, nearest, nearestFails: qualifies[nearest] };
  for (const id of ok.slice(0, 3)) res.selection[`perRec ${id}`] = Object.fromEntries(DEV_AMI.map((n) => [n, fmt(scores.get(n)[id])]));
  res.selection.perRecNearest = Object.fromEntries([...DEV_AMI, ...DEV_SYN].map((n) => [n, fmt(scores.get(n)[nearest])]));
  writeFileSync(`${H}/dev-results.json`, JSON.stringify(res, null, 1));
  const spec = GRID.find((g) => g.id === (chosen ?? nearest));
  writeFileSync(`${H}/chosen.json`, JSON.stringify({ chosen, assessed: spec, qualifiedOnDev: !!chosen, frozenAt: new Date().toISOString(),
    protocolSha256: createHash('sha256').update(readFileSync(`${H}/PROTOCOL.md`)).digest('hex') }, null, 1));
  console.log(JSON.stringify({ selection: res.selection.qualified.length, chosen, nearest, nearestFails: qualifies[nearest] }));
} else if (mode === 'heldout') {
  const C = J(`${H}/chosen.json`); const out = { frozen: C, perRec: {} };
  for (const n of HELD) {
    const R = load(rec(n));
    const s0 = score(R, STRATS.H0(R)), s1 = score(R, STRATS.H1(R)), sc = score(R, STRATS[C.assessed.s](R, C.assessed.p));
    const ch = changeAnalysis(R, s1);
    out.perRec[n] = { nemMap: R.nemMap, v1: fmt(s0.m), nemotron: fmt(s1.m), [C.assessed.id]: fmt(sc.m), raw: { v1: s0.m, hyb: sc.m },
      roundTripDERdiff: +(100 * (s0.m.der - J(R.v1).standard.der.der)).toFixed(3), changes: featureTable(ch), unnamed: unnamedAnalysis(R, s0) };
  }
  writeFileSync(`${H}/heldout-results.json`, JSON.stringify(out, null, 1));
  console.log('written');
} else if (mode === 'coffee') {
  const C = J(`${H}/chosen.json`);
  // no reference for the user's recording: build the grid against an empty RTTM-free record
  const v1run = J(`${S}/diar/final/coffee-n3-v1.json`), nemRun = J(`${S}/nemotron/runs/coffee-nemotron.json`);
  writeFileSync(`${H}/coffee-ref-stub.rttm`, '');
  const R = load({ name: 'coffee', v1: `${S}/diar/final/coffee-n3-v1.json`, nem: `${S}/nemotron/runs/coffee-nemotron.json`, rttm: `${H}/coffee-ref-stub.rttm` });
  for (const [id, m] of [['H0', STRATS.H0(R)], ['H1', STRATS.H1(R)], [C.assessed.id, STRATS[C.assessed.s](R, C.assessed.p)]])
    writeFileSync(`${H}/coffee-${id.replace(/[^A-Za-z0-9.=-]+/g, '_')}.json`, JSON.stringify({ duration: R.dur, segments: toSegs(m, R.vocab) }));
  console.log('nemMap', JSON.stringify(R.nemMap), 'v1 dur', v1run.duration, nemRun.duration);
}
if (mode === 'diag') { // dev only, descriptive: where do H2's false changes come from?
  const tally = {}; const inc = (k) => { tally[k] = (tally[k] || 0) + 1; };
  let v1Unknown = 0;
  for (const n of [...DEV_AMI, ...DEV_SYN]) {
    const R = load(rec(n)); v1Unknown += DEV_AMI.includes(n) ? (J(R.v1).unknownS || 0) : 0;
    const h2 = STRATS.H2(R), turns = turnsOf(R.ref), refCh = [];
    for (let i = 1; i < turns.length; i++) if (turns[i].label !== turns[i - 1].label) refCh.push(turns[i].start);
    const refLabels = [...new Set(R.ref.map((x) => x.label))];
    const rm = toMask(R.ref.map((x) => ({ start: x.start, end: x.end, speaker: x.label })), (l) => refLabels.indexOf(l), R.nF);
    const grp = DEV_AMI.includes(n) ? 'AMI' : 'synthetic';
    for (const c of changesOf(toSegs(h2, R.vocab))) {
      if (refCh.some((t) => Math.abs(t - c.t) <= 0.5)) { inc(`${grp} correct`); continue; }
      inc(`${grp} false`);
      const f = Math.round(c.t / FR), short = Math.min(c.prevDur, c.nextDur);
      inc(`${grp} false: shorter side ${short < 0.3 ? '<0.3s' : short < 0.5 ? '0.3-0.5s' : short < 1 ? '0.5-1s' : '>=1s'}`);
      const fromFill = (q) => q >= 0 && q < R.nF && !R.nm[q] && R.v1m[q];
      inc(`${grp} false: ${fromFill(f) || fromFill(f - 1) ? 'touches a v1-filled stretch' : 'Nemotron on both sides'}`);
      const rr = popc(rm[Math.min(f, R.nF - 1)]); inc(`${grp} false: reference at t = ${rr === 0 ? 'silence' : rr === 1 ? 'one speaker' : 'overlap'}`);
    }
  }
  console.log(JSON.stringify({ tally, v1UnknownS_devAMI: +v1Unknown.toFixed(1) }, null, 1));
}
