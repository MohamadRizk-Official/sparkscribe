// Standard speaker-diarization metrics, with the exact semantics of pyannote.metrics 4.1
// (DiarizationErrorRate, JaccardErrorRate), computed exactly on segment boundaries (no frames).
// Cross-checked against pyannote.metrics by accuracy/lab/crosscheck.mjs + crosscheck.py.
//
// Inputs are lists of { start, end, label } in seconds.
//
// Evaluated region (pyannote "uemify"):
//   - UEM = extent of reference ∪ hypothesis (nothing outside it carries labels, so this equals scoring the whole file)
//   - collar c > 0: [t - c/2, t + c/2] removed around EVERY reference segment start and end (c is the total width)
//   - skipOverlap: regions where two reference segments intersect are removed
//   reference and hypothesis are both cropped to what remains.
// Speaker mapping: one-to-one, Hungarian algorithm maximising total co-occurring time inside the evaluated region;
//   only pairs that actually co-occur (> 0 s) are kept. Unmapped hypothesis labels can never be "correct".
// DER per elementary interval of duration d with n_ref reference labels, n_hyp hypothesis labels, n_ok matched:
//   total += d·n_ref, miss += d·max(0, n_ref − n_hyp), false alarm += d·max(0, n_hyp − n_ref),
//   confusion += d·(min(n_ref, n_hyp) − n_ok);  DER = (miss + false alarm + confusion) / total.
// JER: for each reference speaker, (FA + MISS) / |ref ∪ mapped hyp| (1.0 if unmapped); JER = mean over reference
//   speakers (unmapped hypothesis speakers do not add a term, as in pyannote).
//
// SparkScribe outputs that name nobody — "Unknown" and "Overlapping speech" — are NOT speakers: standardHypothesis()
// leaves them out, so in DER their time counts as missed speech (never as success). Diagnostics report them separately.

export const METRICS_VERSION = 'lab-metrics-1';

// one label's segments merged where they overlap or touch (pyannote counts a label once per moment only if its own
// segments do not overlap; we normalise both sides so a speaker can never be counted twice at the same instant)
export function normalize(segs) {
  const by = new Map();
  for (const s of segs) {
    if (!(s.end > s.start)) continue;
    if (!by.has(s.label)) by.set(s.label, []);
    by.get(s.label).push([s.start, s.end]);
  }
  const out = [];
  for (const [label, list] of by) {
    list.sort((a, b) => a[0] - b[0]);
    let cur = null;
    for (const [a, b] of list) {
      if (cur && a <= cur[1]) cur[1] = Math.max(cur[1], b);
      else { if (cur) out.push({ start: cur[0], end: cur[1], label }); cur = [a, b]; }
    }
    if (cur) out.push({ start: cur[0], end: cur[1], label });
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

// SparkScribe segments -> standard hypothesis (named speakers only). namedOverlap: an overlap stretch the engine
// knows the voices of (segment.voices) counts as both of them talking — what the engine claims, not what the
// transcript shows (it shows "Overlapping speech"); reported separately, never as the headline number.
export function standardHypothesis(segments, unknown = 'Unknown', { namedOverlap = false } = {}) {
  const out = [];
  for (const s of segments) {
    if (s.overlap) { if (namedOverlap && s.voices) for (const v of s.voices) out.push({ start: s.start, end: s.end, label: v }); continue; }
    if (s.speaker !== unknown) out.push({ start: s.start, end: s.end, label: s.speaker });
  }
  return normalize(out);
}

const mergeIntervals = (list) => {
  const v = list.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]); const out = [];
  for (const [a, b] of v) { const l = out[out.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], b); else out.push([a, b]); }
  return out;
};

// evaluated region: UEM minus collars minus (optionally) reference overlap
export function evaluatedRegion(ref, hyp, { collar = 0, skipOverlap = false, uem = null } = {}) {
  let base = uem;
  if (!base) {
    const all = [...ref, ...hyp]; if (!all.length) return [];
    base = [[Math.min(...all.map((s) => s.start)), Math.max(...all.map((s) => s.end))]];
  }
  const cut = [];
  if (collar > 0) for (const s of ref) { cut.push([s.start - collar / 2, s.start + collar / 2], [s.end - collar / 2, s.end + collar / 2]); }
  if (skipOverlap) {
    const r = [...ref].sort((a, b) => a.start - b.start);
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length && r[j].start < r[i].end; j++) cut.push([r[j].start, Math.min(r[i].end, r[j].end)]);
  }
  const holes = mergeIntervals(cut);
  const out = [];
  for (const [a, b] of mergeIntervals(base)) {
    let t = a;
    for (const [h0, h1] of holes) { if (h1 <= t || h0 >= b) continue; if (h0 > t) out.push([t, h0]); t = Math.max(t, h1); }
    if (t < b) out.push([t, b]);
  }
  return out;
}

// elementary intervals inside the region: calls fn(duration, refLabels:Set, hypLabels:Set)
function sweep(ref, hyp, region, fn) {
  const cuts = new Set();
  for (const s of ref) { cuts.add(s.start); cuts.add(s.end); }
  for (const s of hyp) { cuts.add(s.start); cuts.add(s.end); }
  for (const [a, b] of region) { cuts.add(a); cuts.add(b); }
  const ts = [...cuts].sort((a, b) => a - b);
  const ev = (list) => list.flatMap((s) => [[s.start, 1, s.label], [s.end, -1, s.label]]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const rEv = ev(ref), hEv = ev(hyp);
  const rOn = new Map(), hOn = new Map();
  let ri = 0, hi = 0, gi = 0;
  const bump = (m, l, d) => { const v = (m.get(l) || 0) + d; if (v) m.set(l, v); else m.delete(l); };
  for (let k = 0; k + 1 < ts.length; k++) {
    const t = ts[k], u = ts[k + 1];
    while (ri < rEv.length && rEv[ri][0] <= t) { bump(rOn, rEv[ri][2], rEv[ri][1]); ri++; }
    while (hi < hEv.length && hEv[hi][0] <= t) { bump(hOn, hEv[hi][2], hEv[hi][1]); hi++; }
    while (gi < region.length && region[gi][1] <= t) gi++;
    if (gi >= region.length) break;
    if (region[gi][0] > t) continue; // a gap of the region (interval endpoints are all cut points)
    fn(u - t, new Set(rOn.keys()), new Set(hOn.keys()));
  }
}

// Hungarian algorithm (maximise). Returns Map rowIndex -> colIndex. Rectangular matrices are padded.
export function hungarianMax(w) {
  const n = w.length, m = n ? w[0].length : 0, N = Math.max(n, m);
  if (!N) return new Map();
  let max = 0; for (const row of w) for (const v of row) max = Math.max(max, v);
  const cost = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => (i < n && j < m ? max - w[i][j] : max)));
  // O(N^3) shortest augmenting path (Jonker-Volgenant style, 1-indexed potentials)
  const u = new Array(N + 1).fill(0), v = new Array(N + 1).fill(0), p = new Array(N + 1).fill(0), way = new Array(N + 1).fill(0);
  for (let i = 1; i <= N; i++) {
    p[0] = i; let j0 = 0; const minv = new Array(N + 1).fill(Infinity), used = new Array(N + 1).fill(false);
    do {
      used[j0] = true; const i0 = p[j0]; let delta = Infinity, j1 = 0;
      for (let j = 1; j <= N; j++) if (!used[j]) {
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= N; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const out = new Map();
  for (let j = 1; j <= N; j++) if (p[j] && p[j] - 1 < n && j - 1 < m) out.set(p[j] - 1, j - 1);
  return out;
}

// optimal mapping hypothesis label -> reference label inside the evaluated region
export function optimalMapping(ref, hyp, region) {
  const rl = [...new Set(ref.map((s) => s.label))], hl = [...new Set(hyp.map((s) => s.label))];
  const ri = new Map(rl.map((l, i) => [l, i])), hiIdx = new Map(hl.map((l, i) => [l, i]));
  const co = hl.map(() => rl.map(() => 0));
  sweep(ref, hyp, region, (d, R, H) => { for (const h of H) for (const r of R) co[hiIdx.get(h)][ri.get(r)] += d; });
  const map = new Map();
  for (const [i, j] of hungarianMax(co)) if (co[i][j] > 0) map.set(hl[i], rl[j]);
  return { map, cooccurrence: co, refLabels: rl, hypLabels: hl };
}

// Diarization error rate (pyannote semantics). ref/hyp: [{start,end,label}] (normalised here)
export function der(refIn, hypIn, opts = {}) {
  const ref = normalize(refIn), hyp = normalize(hypIn);
  const region = evaluatedRegion(ref, hyp, opts);
  const { map } = optimalMapping(ref, hyp, region);
  let total = 0, miss = 0, fa = 0, conf = 0, correct = 0;
  sweep(ref, hyp, region, (d, R, H) => {
    const nr = R.size, nh = H.size; let ok = 0;
    for (const h of H) if (map.has(h) && R.has(map.get(h))) ok++;
    total += d * nr; correct += d * ok;
    miss += d * Math.max(0, nr - nh); fa += d * Math.max(0, nh - nr); conf += d * (Math.min(nr, nh) - ok);
  });
  return { total, correct, missed: miss, falseAlarm: fa, confusion: conf, der: total ? (miss + fa + conf) / total : null, mapping: Object.fromEntries(map) };
}

// Jaccard error rate (pyannote semantics)
export function jer(refIn, hypIn, opts = {}) {
  const ref0 = normalize(refIn), hyp0 = normalize(hypIn);
  const region = evaluatedRegion(ref0, hyp0, opts);
  const crop = (list) => normalize(list.flatMap((s) => region.filter(([a, b]) => b > s.start && a < s.end).map(([a, b]) => ({ start: Math.max(a, s.start), end: Math.min(b, s.end), label: s.label }))));
  const ref = crop(ref0), hyp = crop(hyp0);
  const { map } = optimalMapping(ref, hyp, region);
  const inv = new Map([...map].map(([h, r]) => [r, h]));
  const dur = (l) => l.reduce((t, [a, b]) => t + b - a, 0);
  const tl = (list, label) => mergeIntervals(list.filter((s) => s.label === label).map((s) => [s.start, s.end]));
  const inter = (A, B) => { let t = 0, i = 0, j = 0; while (i < A.length && j < B.length) { const lo = Math.max(A[i][0], B[j][0]), hi = Math.min(A[i][1], B[j][1]); if (hi > lo) t += hi - lo; if (A[i][1] < B[j][1]) i++; else j++; } return t; };
  const per = {};
  for (const r of [...new Set(ref.map((s) => s.label))]) {
    const h = inv.get(r);
    if (h == null) { per[r] = 1; continue; }
    const R = tl(ref, r), H = tl(hyp, h), I = inter(R, H);
    const union = dur(R) + dur(H) - I;
    per[r] = union ? (dur(H) - I + dur(R) - I) / union : 0;
  }
  const v = Object.values(per);
  return { jer: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, perSpeaker: per, mapping: Object.fromEntries(map) };
}

// The standard protocol reported by the lab: primary = collar 0, overlap scored (pyannote benchmark setting)
export function standardMetrics(refIn, hypIn) {
  const pack = (r) => ({ der: r.der, missed: r.missed, falseAlarm: r.falseAlarm, confusion: r.confusion, total: r.total });
  const full = der(refIn, hypIn);
  return {
    protocol: 'pyannote.metrics semantics; hypothesis = named speakers only (Unknown and overlap-marked time count as missed speech)',
    der: { ...pack(full), mapping: full.mapping },
    derCollar025: pack(der(refIn, hypIn, { collar: 0.25 })),
    derNoOverlap: pack(der(refIn, hypIn, { skipOverlap: true })),
    jer: jer(refIn, hypIn).jer,
    jerPerSpeaker: jer(refIn, hypIn).perSpeaker,
  };
}
