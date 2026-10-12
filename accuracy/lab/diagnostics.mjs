// SparkScribe's internal speaker diagnostics (10 ms frames). Moved here unchanged from accuracy/diarize-eval.mjs so
// saved runs can be rescored without the speech models; rescoring reproduces the numbers stored by earlier runs.
// These are NOT standard benchmark metrics (see metrics.mjs): "derPct" here is over single-speaker reference speech
// only, counts Unknown separately, and maps at most 9 labels by brute force. Report both, never mix them.
//
// segments: SparkScribe output [{ start, end, speaker, overlap? }]; ref: [{ start, end, speaker }]; dur: seconds.
export const FR = 0.01;

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function frames(segments, dur) {
  const nF = Math.ceil(dur / FR);
  const hypFrames = Array.from({ length: nF }, () => new Set());
  // a segment marked as overlapping speech adds OVERLAP (several people, not attributed to one)
  for (const s of segments) for (let f = Math.floor(s.start / FR); f < Math.min(nF, Math.ceil(s.end / FR)); f++) hypFrames[f].add(s.overlap ? 'OVERLAP' : s.speaker);
  return { nF, hypFrames };
}

export function hypRunsOf(segments) {
  const runs = [];
  for (const s of [...segments].sort((a, b) => a.start - b.start)) {
    const last = runs[runs.length - 1];
    if (last && last.speaker === s.speaker && s.start - last.end < 0.5) last.end = Math.max(last.end, s.end);
    else runs.push({ speaker: s.speaker, start: s.start, end: s.end });
  }
  return runs;
}

export function summary(segments, dur, UNKNOWN) {
  const { hypFrames } = frames(segments, dur);
  const labels = [...new Set(segments.filter((s) => !s.overlap).map((s) => s.speaker))].filter((l) => l !== UNKNOWN);
  const talk = (l) => hypFrames.reduce((t, f) => t + (f.has(l) ? FR : 0), 0);
  return { detectedSpeakers: labels.length, speakerTime: Object.fromEntries(labels.map((l) => [l, +talk(l).toFixed(1)])), unknownS: +talk(UNKNOWN).toFixed(1) };
}

export function internalDiagnostics(segments, ref, dur, UNKNOWN) {
  const { nF, hypFrames } = frames(segments, dur);
  const hypRuns = hypRunsOf(segments);
  const labels = [...new Set(segments.filter((s) => !s.overlap).map((s) => s.speaker))].filter((l) => l !== UNKNOWN);
  const talk = (l) => hypFrames.reduce((t, f) => t + (f.has(l) ? FR : 0), 0);
  const refFrames = Array.from({ length: nF }, () => new Set());
  for (const s of ref) for (let f = Math.floor(s.start / FR); f < Math.min(nF, Math.ceil(s.end / FR)); f++) refFrames[f].add(s.speaker);
  const refSpk = [...new Set(ref.map((r) => r.speaker))];

  // optimal one-to-one map hyp label -> ref speaker (by overlapping time); small sets, so brute force
  const ov = new Map();
  for (let f = 0; f < nF; f++) for (const h of hypFrames[f]) for (const r of refFrames[f]) ov.set(`${h}|${r}`, (ov.get(`${h}|${r}`) || 0) + FR);
  let bestMap = new Map(), bestScore = -1;
  const hyps = labels.slice(0, 9);
  const search = (i, used, map, score) => {
    if (i === hyps.length) { if (score > bestScore) { bestScore = score; bestMap = new Map(map); } return; }
    search(i + 1, used, map, score); // this label maps to nobody
    for (const r of refSpk) if (!used.has(r)) {
      used.add(r); map.set(hyps[i], r);
      search(i + 1, used, map, score + (ov.get(`${hyps[i]}|${r}`) || 0));
      used.delete(r); map.delete(hyps[i]);
    }
  };
  search(0, new Set(), new Map(), 0);

  // DER-style accounting over single-speaker reference frames (overlap reported separately)
  let refSpeech = 0, missed = 0, unknown = 0, confusion = 0, fa = 0, overlap = 0;
  for (let f = 0; f < nF; f++) {
    const r = refFrames[f], h = [...hypFrames[f]];
    if (r.size > 1) { overlap += FR; continue; }
    if (!r.size) { if (h.some((x) => x !== UNKNOWN)) fa += FR; continue; }
    refSpeech += FR;
    const [rs] = r;
    const real = h.filter((x) => x !== UNKNOWN);
    if (!h.length) missed += FR;
    else if (!real.length) unknown += FR;
    else if (!real.some((x) => bestMap.get(x) === rs)) confusion += FR;
  }

  // identity per reference turn: the label carrying most of each turn (≥ 1.5 s of single-speaker speech)
  const turns = [];
  for (const s of [...ref].sort((a, b) => a.start - b.start)) {
    if (s.end - s.start < 1.5) continue;
    const count = new Map(); let n = 0;
    for (let f = Math.floor(s.start / FR); f < Math.min(nF, Math.ceil(s.end / FR)); f++) {
      if (refFrames[f].size !== 1) continue;
      n++;
      for (const h of hypFrames[f]) count.set(h, (count.get(h) || 0) + 1);
    }
    if (n < 100) continue;
    const [top, c] = [...count].filter(([h]) => h !== UNKNOWN).sort((a, b) => b[1] - a[1])[0] || [null, 0];
    turns.push({ ref: s.speaker, start: s.start, end: s.end, label: c / n >= 0.5 ? top : null });
  }
  // wrong-identity turns: carried by a label that belongs to another person
  const wrongTurns = turns.filter((t) => t.label && bestMap.get(t.label) !== t.ref);
  // identity changes: per person, how often the carrying label changes between consecutive turns
  const changes = []; const perPerson = {};
  for (const r of refSpk) {
    const seq = turns.filter((t) => t.ref === r && t.label);
    let k = 0;
    for (let i = 1; i < seq.length; i++) if (seq[i].label !== seq[i - 1].label) { k++; changes.push({ ref: r, at: fmt(seq[i].start), from: seq[i - 1].label, to: seq[i].label }); }
    const firstHalf = seq.filter((t) => t.start < dur / 2), secondHalf = seq.filter((t) => t.start >= dur / 2);
    const major = (list) => { const m = new Map(); for (const t of list) m.set(t.label, (m.get(t.label) || 0) + (t.end - t.start)); return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] || null; };
    perPerson[r] = { turns: seq.length, labelChanges: k, mainLabelFirstHalf: major(firstHalf), mainLabelSecondHalf: major(secondHalf) };
  }
  // speaker changes at turn level (±1 s)
  const refChanges = []; const sortedRef = [...ref].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sortedRef.length; i++) if (sortedRef[i].speaker !== sortedRef[i - 1].speaker) refChanges.push(sortedRef[i].start);
  const hypChanges = []; const realRuns = hypRuns.filter((r) => r.speaker !== UNKNOWN);
  for (let i = 1; i < realRuns.length; i++) if (realRuns[i].speaker !== realRuns[i - 1].speaker) hypChanges.push(realRuns[i].start);
  const near = (a, list) => list.some((b) => Math.abs(a - b) <= 1.0);

  // ---------- short replies, false splits, overlap, extra speakers, merges ----------
  const refTurns = [];
  for (const r of [...ref].sort((a, b) => a.start - b.start)) {
    const last = refTurns.findLast((t) => t.speaker === r.speaker);
    if (last && r.start - last.end < 0.3) last.end = Math.max(last.end, r.end); else refTurns.push({ ...r });
  }
  // short replies: a turn of at most 2 s with someone else speaking within 1 s (backchannels, interruptions)
  const shorts = refTurns.filter((r) => r.end - r.start <= 2 && refTurns.some((o) => o.speaker !== r.speaker && o.start < r.end + 1 && o.end > r.start - 1));
  // standalone = said in its own moment; saidOver = entirely while someone else keeps talking (a backchannel)
  const out = { own: 0, overlap: 0, absorbed: 0, unknown: 0, missed: 0, other: 0 };
  const stand = { total: 0, own: 0, overlap: 0, absorbed: 0, unknown: 0, missed: 0, other: 0 }, over = { total: 0, own: 0, overlap: 0, absorbed: 0, unknown: 0, missed: 0, other: 0 };
  const map = bestMap;
  for (const r of shorts) {
    const said = ref.some((o) => o.speaker !== r.speaker && o.start <= r.start && o.end >= r.end) ? over : stand;
    said.total++;
    const tally = (k) => { out[k]++; said[k]++; };
    let n = 0, own = 0, ovn = 0, unk = 0, none = 0; const others = new Map();
    for (let f = Math.floor(r.start / FR); f < Math.min(nF, Math.ceil(r.end / FR)); f++) {
      n++;
      const h = hypFrames[f];
      if (!h.size) { none++; continue; }
      if ([...h].some((x) => map.get(x) === r.speaker)) own++;
      else if (h.has('OVERLAP')) ovn++;
      else if ([...h].every((x) => x === UNKNOWN)) unk++;
      else for (const x of h) if (x !== UNKNOWN) others.set(x, (others.get(x) || 0) + 1);
    }
    if (own / n >= 0.4) tally('own');
    else if (ovn / n >= 0.4) tally('overlap');
    else if (none / n >= 0.6) tally('missed');
    else if (unk / n >= 0.4) tally('unknown');
    else {
      const [x] = [...others].sort((a, b) => b[1] - a[1])[0] || [];
      const nearby = x && refTurns.some((o) => o.speaker === map.get(x) && o.start < r.end + 1 && o.end > r.start - 1);
      tally(nearby ? 'absorbed' : 'other');
    }
  }
  // false splits: short hyp runs given to a person who is not speaking there at all
  let falseSplits = 0, falseSplitS = 0;
  for (const run of hypRuns) {
    if (run.speaker === UNKNOWN || run.end - run.start > 2 || !map.has(run.speaker)) continue;
    let n = 0, his = 0;
    for (let f = Math.floor(run.start / FR); f < Math.min(nF, Math.ceil(run.end / FR)); f++) { if (!refFrames[f].size) continue; n++; if (refFrames[f].has(map.get(run.speaker))) his++; }
    if (n >= 20 && his / n < 0.2) { falseSplits++; falseSplitS += run.end - run.start; }
  }
  // overlap: frames marked as overlapping speech vs frames where the reference has 2+ people
  let hypOv = 0, hit = 0, refOv = 0;
  for (let f = 0; f < nF; f++) {
    const r2 = refFrames[f].size > 1;
    if (r2) refOv++;
    if (hypFrames[f].has('OVERLAP')) { hypOv++; if (r2) hit++; }
  }
  // extra speakers: labels with real speech that map to nobody; merges: one label carrying 2+ people
  const extra = labels.filter((l) => !map.has(l) && talk(l) >= 5).length;
  let merges = 0;
  for (const l of labels) {
    const people = refSpk.filter((r) => {
      let tot = 0, under = 0;
      for (let f = 0; f < nF; f++) { if (refFrames[f].size !== 1 || !refFrames[f].has(r)) continue; tot++; if (hypFrames[f].has(l)) under++; }
      return tot && under / tot >= 0.25;
    });
    if (people.length >= 2) merges++;
  }

  return {
    referenceSpeakers: refSpk.length,
    speakerCountCorrect: labels.length === refSpk.length,
    mapping: Object.fromEntries(bestMap),
    singleSpeakerSpeechS: +refSpeech.toFixed(1), overlapS: +overlap.toFixed(1),
    missedPct: +(100 * missed / refSpeech).toFixed(2), unknownPct: +(100 * unknown / refSpeech).toFixed(2),
    confusionPct: +(100 * confusion / refSpeech).toFixed(2), falseAlarmPct: +(100 * fa / refSpeech).toFixed(2),
    derPct: +(100 * (missed + unknown + confusion + fa) / refSpeech).toFixed(2),
    turnsScored: turns.length, wrongIdentityTurns: wrongTurns.length, wrongIdentityPct: +(100 * wrongTurns.length / Math.max(1, turns.filter((t) => t.label).length)).toFixed(1),
    identitySwaps: changes.length, perPerson,
    speakerChanges: { reference: refChanges.length, detected: hypChanges.length,
      missed: refChanges.filter((c) => !near(c, hypChanges)).length, false: hypChanges.filter((c) => !near(c, refChanges)).length },
    swapExamples: changes.slice(0, 12),
    shortReplies: { total: shorts.length, ...out }, standaloneReplies: stand, saidOverReplies: over, falseSplits, falseSplitS: +falseSplitS.toFixed(1),
    overlap: { refS: +(refOv * FR).toFixed(1), markedS: +(hypOv * FR).toFixed(1), precision: hypOv ? +(hit / hypOv).toFixed(2) : null, recall: refOv ? +(hit / refOv).toFixed(2) : null },
    falseExtraSpeakers: extra, falseMerges: merges,
  };
}
