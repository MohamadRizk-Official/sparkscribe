// Lab diagnostics on exact times, using the STANDARD mapping (metrics.mjs: Hungarian, collar 0, overlap scored).
// Every threshold used here is written into the result, so a number is never read without its definition.
import { normalize, evaluatedRegion, optimalMapping } from './metrics.mjs';

export const EXTRAS_DEF = {
  changeTolerancesS: [0.5, 1.0],
  shortBucketsS: [[0, 0.5], [0.5, 1], [1, 2], [2, 3]],
  refTurnJoinGapS: 0.3, // reference segments of one person closer than this form one turn
  shortMajority: 0.5, // a short turn's outcome = the category covering at least half of it, else "mixed"
  splitShare: 0.15, // a person is "split" when a second hypothesis label carries >= 15 % of their single-speaker time
  mergeShare: 0.15, // a label "merges" people when >= 15 % of its single-speaker time belongs to a second person
  minPersonS: 5, // people / labels with less single-speaker time than this are not judged for splits / merges
  driftWindowS: 600, // identity drift: wrong-person rate in the first vs the last 10 minutes (one global mapping)
};

const D = EXTRAS_DEF;

// elementary intervals over ref / hyp / extra marks: fn(t0, t1, refSet, hypSet, marks:Set)
function sweep(ref, hyp, marks, fn) {
  const cuts = new Set();
  for (const s of [...ref, ...hyp, ...marks]) { cuts.add(s.start); cuts.add(s.end); }
  const ts = [...cuts].sort((a, b) => a - b);
  const ev = (list) => list.flatMap((s) => [[s.start, 1, s.label], [s.end, -1, s.label]]).sort((p, q) => p[0] - q[0]);
  const lists = [ev(ref), ev(hyp), ev(marks)], on = [new Map(), new Map(), new Map()], idx = [0, 0, 0];
  for (let k = 0; k + 1 < ts.length; k++) {
    const t = ts[k];
    for (let q = 0; q < 3; q++) while (idx[q] < lists[q].length && lists[q][idx[q]][0] <= t) {
      const [, d, l] = lists[q][idx[q]++]; const v = (on[q].get(l) || 0) + d; if (v) on[q].set(l, v); else on[q].delete(l);
    }
    fn(t, ts[k + 1], new Set(on[0].keys()), new Set(on[1].keys()), new Set(on[2].keys()));
  }
}

const turnsOf = (ref) => {
  const turns = [];
  for (const r of [...ref].sort((a, b) => a.start - b.start)) {
    const last = turns.findLast((t) => t.label === r.label);
    if (last && r.start - last.end < D.refTurnJoinGapS) last.end = Math.max(last.end, r.end); else turns.push({ ...r });
  }
  return turns.sort((a, b) => a.start - b.start);
};

// segments: SparkScribe output; ref: [{start,end,label}]; hyp: standard hypothesis (named speakers only)
export function labExtras(segments, refIn, hypIn, unknown = 'Unknown') {
  const ref = normalize(refIn), hyp = normalize(hypIn);
  const marks = normalize(segments.filter((s) => s.overlap || s.speaker === unknown).map((s) => ({ start: s.start, end: s.end, label: s.overlap ? 'OVERLAP' : 'UNKNOWN' })));
  const region = evaluatedRegion(ref, hyp);
  const { map } = optimalMapping(ref, hyp, region);

  // ---- where Unknown / "overlapping speech" landed, and wrong vs correct person time ----
  const acc = { unknown: { nonSpeech: 0, single: 0, overlap: 0 }, overlapMark: { nonSpeech: 0, single: 0, overlap: 0 } };
  let single = 0, correctS = 0, wrongS = 0, nobodyS = 0;
  const personTime = new Map(); // ref person -> Map(hyp label -> s), single-speaker time only
  const labelTime = new Map(); // hyp label -> Map(ref person -> s)
  sweep(ref, hyp, marks, (t, u, R, H, M) => {
    const d = u - t, k = R.size === 0 ? 'nonSpeech' : R.size === 1 ? 'single' : 'overlap';
    if (M.has('UNKNOWN')) acc.unknown[k] += d;
    if (M.has('OVERLAP')) acc.overlapMark[k] += d;
    if (R.size !== 1) return;
    const [r] = R; single += d;
    if ([...H].some((h) => map.get(h) === r)) correctS += d; else if (H.size) wrongS += d; else nobodyS += d;
    for (const h of H) {
      if (!personTime.has(r)) personTime.set(r, new Map()); personTime.get(r).set(h, (personTime.get(r).get(h) || 0) + d);
      if (!labelTime.has(h)) labelTime.set(h, new Map()); labelTime.get(h).set(r, (labelTime.get(h).get(r) || 0) + d);
    }
  });
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(2)]));
  const singleSpeech = {
    seconds: +single.toFixed(1),
    correctPersonPct: single ? +(100 * correctS / single).toFixed(2) : null,
    wrongPersonPct: single ? +(100 * wrongS / single).toFixed(2) : null, // a named label that is someone else
    noNamedLabelPct: single ? +(100 * nobodyS / single).toFixed(2) : null, // missed, Unknown or overlap-marked
  };

  // ---- splits and merges per person / label (single-speaker time) ----
  const splits = [], merges = [];
  for (const [r, m] of personTime) {
    const tot = [...m.values()].reduce((a, b) => a + b, 0); if (tot < D.minPersonS) continue;
    const others = [...m].filter(([h]) => map.get(h) !== r && m.get(h) / tot >= D.splitShare);
    if (others.length) splits.push({ person: r, intoLabels: others.map(([h, s]) => ({ label: h, share: +(s / tot).toFixed(2) })) });
  }
  for (const [h, m] of labelTime) {
    const tot = [...m.values()].reduce((a, b) => a + b, 0); if (tot < D.minPersonS) continue;
    const people = [...m].filter(([, s]) => s / tot >= D.mergeShare);
    if (people.length >= 2) merges.push({ label: h, people: people.map(([r, s]) => ({ person: r, share: +(s / tot).toFixed(2) })) });
  }
  const refPeople = [...new Set(ref.map((s) => s.label))];
  const lostPeople = refPeople.filter((r) => ![...map.values()].includes(r));

  // ---- speaker changes (named-label runs, Unknown / overlap ignored) ----
  const hypRuns = [];
  for (const s of hyp) { const l = hypRuns[hypRuns.length - 1]; if (l && l.label === s.label && s.start - l.end < 0.5) l.end = Math.max(l.end, s.end); else hypRuns.push({ ...s }); }
  const hypCh = []; for (let i = 1; i < hypRuns.length; i++) if (hypRuns[i].label !== hypRuns[i - 1].label) hypCh.push(hypRuns[i].start);
  const turns = turnsOf(ref);
  const refCh = []; for (let i = 1; i < turns.length; i++) if (turns[i].label !== turns[i - 1].label) refCh.push(turns[i].start);
  const changes = {};
  for (const tol of D.changeTolerancesS) {
    const near = (a, list) => list.some((b) => Math.abs(a - b) <= tol);
    changes[`within${tol}s`] = { reference: refCh.length, detected: hypCh.length, missed: refCh.filter((c) => !near(c, hypCh)).length, false: hypCh.filter((c) => !near(c, refCh)).length };
  }

  // ---- short utterances by duration (reference turns), standalone vs said over someone ----
  const buckets = {};
  for (const [a, b] of D.shortBucketsS) buckets[`${a}-${b}s`] = { standalone: tally0(), saidOver: tally0() };
  for (const turn of turns) {
    const len = turn.end - turn.start;
    const bk = D.shortBucketsS.find(([a, b]) => len > a && len <= b); if (!bk) continue;
    const over = ref.some((o) => o.label !== turn.label && o.start <= turn.start && o.end >= turn.end);
    const cat = { own: 0, otherPerson: 0, unknown: 0, overlapMark: 0, missed: 0 };
    sweep([{ ...turn }], hyp.filter((s) => s.end > turn.start && s.start < turn.end), marks.filter((s) => s.end > turn.start && s.start < turn.end), (t, u, R, H, M) => {
      if (!R.size) return; const d = u - t;
      if ([...H].some((h) => map.get(h) === turn.label)) cat.own += d; else if (H.size) cat.otherPerson += d;
      else if (M.has('OVERLAP')) cat.overlapMark += d; else if (M.has('UNKNOWN')) cat.unknown += d; else cat.missed += d;
    });
    const [best, v] = Object.entries(cat).sort((p, q) => q[1] - p[1])[0];
    const out = v / len >= D.shortMajority ? best : 'mixed';
    const t = buckets[`${bk[0]}-${bk[1]}s`][over ? 'saidOver' : 'standalone']; t.total++; t[out]++;
  }

  // ---- identity drift: wrong-person share of single-speaker time, first vs last window (global mapping) ----
  const end = Math.max(0, ...ref.map((s) => s.end));
  const windowRate = (w0, w1) => {
    let s = 0, wrong = 0;
    sweep(ref, hyp, [], (t, u, R, H) => {
      const a = Math.max(t, w0), b = Math.min(u, w1); if (b <= a || R.size !== 1) return;
      const [r] = R; s += b - a; if (H.size && ![...H].some((h) => map.get(h) === r)) wrong += b - a;
    });
    return s ? +(100 * wrong / s).toFixed(2) : null;
  };
  const drift = end >= 2 * D.driftWindowS
    ? { firstWindowWrongPct: windowRate(0, D.driftWindowS), lastWindowWrongPct: windowRate(end - D.driftWindowS, end) }
    : { note: `recording shorter than ${2 * D.driftWindowS / 60} min` };

  return {
    definitions: D,
    mapping: Object.fromEntries(map),
    speakerCount: { reference: refPeople.length, detected: new Set(hyp.map((s) => s.label)).size, lostPeople },
    singleSpeech,
    unknownS: round(acc.unknown), overlapMarkedS: round(acc.overlapMark),
    splits, merges, changes, shortUtterances: buckets, drift,
  };
}
function tally0() { return { total: 0, own: 0, otherPerson: 0, unknown: 0, overlapMark: 0, missed: 0, mixed: 0 }; }

// Partial human labels (spans with speaker numbers): each span's majority named label, mapped one-to-one to the
// span numbers by the Hungarian algorithm on span time (the same rule as DER). Unknown / overlap / nothing = "unsure".
export function scoreSpans(segments, spans, unknown = 'Unknown') {
  const ref = spans.map((s) => ({ start: s.start, end: s.end, label: String(s.label) }));
  const hyp = normalize(segments.filter((s) => !s.overlap && s.speaker !== unknown).map((s) => ({ start: s.start, end: s.end, label: s.speaker })));
  const region = evaluatedRegion(ref, hyp.filter((h) => ref.some((r) => h.end > r.start && h.start < r.end)));
  const { map } = optimalMapping(ref, hyp, region);
  let right = 0, wrong = 0, unsure = 0; const detail = [];
  for (const sp of ref) {
    const t = new Map(); let named = 0;
    for (const h of hyp) { const o = Math.min(h.end, sp.end) - Math.max(h.start, sp.start); if (o > 0) { t.set(h.label, (t.get(h.label) || 0) + o); named += o; } }
    const [top, v] = [...t].sort((a, b) => b[1] - a[1])[0] || [null, 0];
    const unnamedShare = 1 - named / (sp.end - sp.start);
    let got = null;
    if (top && v >= unnamedShare * (sp.end - sp.start)) got = map.get(top) ?? `unmapped:${top}`;
    const verdict = got === sp.label ? 'right' : got == null ? 'unsure' : 'wrong';
    if (verdict === 'right') right++; else if (verdict === 'wrong') wrong++; else unsure++;
    detail.push({ start: sp.start, end: sp.end, expected: sp.label, got, verdict });
  }
  return { spans: ref.length, right, wrong, unsure, mapping: Object.fromEntries(map), detail };
}
