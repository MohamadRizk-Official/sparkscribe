// A system's output on the user's 23:22 recording, scored against the user's own labels with the same rules as
// before: round-1 spans (27), round-2 review answers (72 scored), and the hand-marked switch zones (33, ±0.3 s slack).
// Labels are mapped to the v1 numbering (Speaker 1/2/3) by shared single-speaker time with the v1 run.
//   node coffee-eval.cjs <v1-run.json> <system-run.json> <truth-v3.json> <review.json> <switch-marks.json> [name]
const fs = require('fs');
const [v1F, sysF, truthF, reviewF, marksF, name = 'system'] = process.argv.slice(2);
const V1 = JSON.parse(fs.readFileSync(v1F, 'utf8')).segments, S = JSON.parse(fs.readFileSync(sysF, 'utf8')).segments;
const num = { SPEAKER_00: 1, SPEAKER_01: 2, SPEAKER_02: 3 };
const active = (segs, t) => [...new Set(segs.filter((x) => x.start <= t && x.end > t && x.speaker !== 'Unknown').map((x) => (x.overlap ? 'OV' : x.speaker)))];
// system label -> v1 number, by shared time where both have exactly one named speaker
const votes = new Map();
for (let t = 0; t < 1402; t += 0.1) { const a = active(V1, t), b = active(S, t); if (a.length === 1 && num[a[0]] && b.length === 1 && b[0] !== 'OV') votes.set(`${b[0]}|${num[a[0]]}`, (votes.get(`${b[0]}|${num[a[0]]}`) || 0) + 1); }
const map = new Map(); for (const [k] of [...votes].sort((p, q) => q[1] - p[1])) { const [b, a] = k.split('|'); if (!map.has(b) && ![...map.values()].includes(+a)) map.set(b, +a); }
const sysAt = (t) => { const a = active(S, t); if (!a.length) return null; if (a.length > 1 || a[0] === 'OV') return 'Several people at once'; return map.has(a[0]) ? `Speaker ${map.get(a[0])}` : `other voice (${a[0]})`; };
const majority = (s0, e0) => { const c = new Map(); let n = 0; for (let t = s0; t < e0; t += 0.02) { n++; const l = sysAt(t) ?? 'nothing'; c.set(l, (c.get(l) || 0) + 1); } const [l, k] = [...c].sort((p, q) => q[1] - p[1])[0]; return { l, share: k / n }; };

// round 1: 27 spans (only the clearly single-speaker part of each moment)
const truth = JSON.parse(fs.readFileSync(truthF, 'utf8'));
const r1 = truth.labels.filter((l) => l.source.includes('round 1'));
let r1right = 0, r1wrong = 0, r1none = 0;
for (const l of r1) { const m = majority(l.start, l.end).l; if (m === `Speaker ${l.speaker}`) r1right++; else if (/^Speaker \d$/.test(m)) r1wrong++; else r1none++; }

// round 2: same verdict rules as score-review.cjs
const verdict = (truthAns, said) => {
  if (!truthAns || /^unknown|^unsure/.test(truthAns)) return null;
  const named = /^Speaker \d$/.test(said);
  if (/^Speaker \d$/.test(truthAns)) return said === truthAns ? 'right' : named ? 'wrong' : 'noName';
  if (truthAns.startsWith('several')) return said.startsWith('Several') ? 'right' : named ? 'partly' : 'noName';
  const m = /Speaker (\d) then Speaker (\d)/.exec(truthAns);
  if (m) return named ? ([`Speaker ${m[1]}`, `Speaker ${m[2]}`].includes(said) ? 'partly' : 'wrong') : 'noName';
  return null;
};
const pts = { right: 2, partly: 1, noName: 0, wrong: -1 };
const review = JSON.parse(fs.readFileSync(reviewF, 'utf8'));
const tally = { v1: { right: 0, partly: 0, wrong: 0, noName: 0 }, [name]: { right: 0, partly: 0, wrong: 0, noName: 0 } }; let better = 0, worse = 0, tie = 0, n = 0;
for (const it of review.items) {
  const ans = it.answer ?? it.earlierAnswer; const a = verdict(ans, it.v1); if (!a) continue;
  const said = majority(it.start, it.end).l; const b = verdict(ans, said) ?? 'noName';
  n++; tally.v1[a]++; tally[name][b]++; const d = pts[b] - pts[a]; if (d > 0) better++; else if (d < 0) worse++; else tie++;
}

// switch zones (same method as before: switch first -> then within the zone ± 0.3 s)
const marks = JSON.parse(fs.readFileSync(marksF, 'utf8')); const SLACK = 0.3;
const who = (t) => { const l = sysAt(t); return l && /^Speaker \d$/.test(l) ? +l.slice(8) : l; };
const sw = { onTime: 0, off: 0, missed: 0, wrongPeople: 0 }; let zones = 0;
for (const it of marks.items) {
  const p = [it.switchAt, it.firstEnds, it.thenStarts].filter((x) => x != null); if (it.type === 'uncertain' || !p.length) continue; zones++;
  const lo = Math.min(...p), hi = Math.max(...p); let best = null;
  for (let t = lo - 2.5; t <= hi + 2.5; t += 0.02) {
    const a = who(t - 0.02), b = who(t);
    if (a !== b && b === it.then) { let q = t - 0.02, prev = null; while (q > t - 3) { const x = who(q); if (x != null && typeof x === 'number' && x !== it.then) { prev = x; break; } q -= 0.02; } if (prev === it.first) { const d = Math.max(0, lo - t, t - hi); if (!best || d < best) best = d; } }
  }
  const okB = who(lo - SLACK - 0.15) === it.first, okA = who(hi + SLACK + 0.15) === it.then;
  if (best != null && best <= SLACK) sw.onTime++; else if (best != null && best <= 1.5) sw.off++; else if (okB || okA) sw.missed++; else sw.wrongPeople++;
}
console.log(JSON.stringify({ name, labelMap: Object.fromEntries(map), round1: { right: r1right, wrong: r1wrong, noName: r1none, of: r1.length },
  round2: { scored: n, v1: tally.v1, [name]: tally[name], headToHead: { [name + ' better']: better, 'v1 better': worse, tie } }, switches: { zones, ...sw } }, null, 1));
