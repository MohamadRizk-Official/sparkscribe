// Cross-check of accuracy/lab/metrics.mjs against pyannote.metrics.
//   node accuracy/lab/crosscheck.mjs --python <path to python with pyannote.metrics> [--saved file.json ...]
// Cases: hand-made edge cases (collars, overlap, unmapped and extra speakers, non-greedy mappings, empty sides),
// 300 seeded random annotations, and optionally real saved runs (--saved results with a reference RTTM).
// Writes nothing to the repository. Exits 1 on any difference larger than 1e-6 s (components) / 1e-9 (rates).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { der, jer, normalize, standardHypothesis } from './metrics.mjs';
import { readRttm } from './reference.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const python = opt('--python');
if (!python) { console.error('usage: node accuracy/lab/crosscheck.mjs --python <python with pyannote.metrics> [--saved run.json:ref.rttm ...]'); process.exit(1); }

const S = (s, e, l) => ({ start: s, end: e, label: l });
const hand = [
  ['perfect', [S(0, 5, 'A'), S(5, 9, 'B')], [S(0, 5, 'x'), S(5, 9, 'y')]],
  ['permuted labels', [S(0, 5, 'A'), S(5, 9, 'B')], [S(0, 5, 'B'), S(5, 9, 'A')]],
  ['empty hypothesis', [S(0, 5, 'A'), S(6, 9, 'B')], []],
  ['false alarm in silence', [S(0, 5, 'A')], [S(0, 5, 'x'), S(7, 9, 'x')]],
  ['one label for two people', [S(0, 5, 'A'), S(5, 10, 'B')], [S(0, 10, 'x')]],
  ['reference overlap, one hyp', [S(0, 6, 'A'), S(4, 10, 'B')], [S(0, 5, 'x'), S(5, 10, 'y')]],
  ['hyp overlap, ref single', [S(0, 10, 'A')], [S(0, 10, 'x'), S(3, 5, 'y')]],
  ['extra hyp speaker', [S(0, 4, 'A'), S(4, 8, 'B')], [S(0, 4, 'x'), S(4, 6, 'y'), S(6, 8, 'z')]],
  ['non-greedy mapping', [S(0, 10, 'A'), S(10, 16, 'B')], [S(0, 6, 'x'), S(6, 10, 'y'), S(10, 16, 'x')]],
  ['adjacent same-speaker segments', [S(0, 3, 'A'), S(3, 6, 'A'), S(6, 9, 'B')], [S(0, 6.2, 'x'), S(6.2, 9, 'y')]],
  ['hyp beyond reference', [S(2, 6, 'A')], [S(0, 8, 'x')]],
  ['unmapped reference speaker', [S(0, 5, 'A'), S(5, 6, 'B'), S(6, 10, 'C')], [S(0, 10, 'x')]],
  ['short reply inside a turn', [S(0, 10, 'A'), S(4, 4.6, 'B')], [S(0, 10, 'x')]],
  ['self-overlapping input (normalised)', [S(0, 5, 'A'), S(3, 8, 'A'), S(8, 9, 'B')], [S(0, 9, 'x'), S(1, 2, 'x')]],
];
const cases = [];
for (const [name, ref, hyp] of hand) for (const [tag, o] of [['', {}], [' c0.5', { collar: 0.5 }], [' noOv', { skipOverlap: true }], [' c0.25+noOv', { collar: 0.25, skipOverlap: true }]]) cases.push({ name: name + tag, ref, hyp, ...o });

// seeded random annotations: up to 5 reference / 6 hypothesis speakers, overlaps, gaps, millisecond times
let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const randomAnn = (nLab, n, len) => Array.from({ length: n }, () => { const s = Math.round(rnd() * len * 1000) / 1000, d = Math.round((0.05 + rnd() * 6) * 1000) / 1000; return S(s, +(s + d).toFixed(3), `L${Math.floor(rnd() * nLab)}`); });
for (let k = 0; k < 300; k++) {
  const o = k % 4 === 0 ? {} : k % 4 === 1 ? { collar: 0.25 } : k % 4 === 2 ? { skipOverlap: true } : { collar: 0.5, skipOverlap: true };
  cases.push({ name: `random ${k}`, ref: randomAnn(1 + Math.floor(rnd() * 5), 3 + Math.floor(rnd() * 25), 60), hyp: randomAnn(1 + Math.floor(rnd() * 6), Math.floor(rnd() * 30), 60), ...o });
}
// real saved runs (standard hypothesis = named speakers only), full protocol
for (const item of args.filter((a, i) => args[i - 1] === '--saved')) {
  const [file, rttm] = item.split('|');
  const run = JSON.parse(readFileSync(file, 'utf8'));
  const ref = readRttm(readFileSync(rttm, 'utf8'));
  const hyp = standardHypothesis(run.segments);
  for (const [tag, o] of [['', {}], [' c0.25', { collar: 0.25 }], [' noOv', { skipOverlap: true }]]) cases.push({ name: `saved ${file.split(/[\\/]/).pop()}${tag}`, ref, hyp, ...o });
}
// both sides get identical, normalised inputs (pyannote counts a label twice where its own segments overlap)
for (const c of cases) { c.ref = normalize(c.ref); c.hyp = normalize(c.hyp); }

const dir = mkdtempSync(join(tmpdir(), 'lab-xcheck-'));
const casesFile = join(dir, 'cases.json');
writeFileSync(casesFile, JSON.stringify(cases.map((c) => ({ ...c, ref: c.ref.map((s) => [s.start, s.end, s.label]), hyp: c.hyp.map((s) => [s.start, s.end, s.label]) }))));
const py = JSON.parse(execFileSync(python, [resolve(HERE, 'crosscheck.py'), casesFile], { encoding: 'utf8', maxBuffer: 1 << 28 }));

let bad = 0, worst = { comp: 0, rate: 0 };
cases.forEach((c, i) => {
  const o = { collar: c.collar || 0, skipOverlap: !!c.skipOverlap };
  const d = der(c.ref, c.hyp, o), j = c.ref.length ? jer(c.ref, c.hyp, o).jer : null, p = py[i];
  const diffs = [];
  for (const k of ['total', 'missed', 'falseAlarm', 'confusion', 'correct']) { const e = Math.abs(d[k] - p[k]); worst.comp = Math.max(worst.comp, e); if (e > 1e-6) diffs.push(`${k} js ${d[k]} py ${p[k]}`); }
  for (const [k, a, b] of [['der', d.der, p.der], ['jer', j, p.jer]]) {
    if (a == null || b == null) { if ((a == null) !== (b == null)) diffs.push(`${k} js ${a} py ${b}`); continue; }
    const e = Math.abs(a - b); worst.rate = Math.max(worst.rate, e); if (e > 1e-9) diffs.push(`${k} js ${a} py ${b}`);
  }
  if (diffs.length) { bad++; if (bad <= 15) console.log(`MISMATCH ${c.name}: ${diffs.join('; ')}`); }
});
console.log(JSON.stringify({ cases: cases.length, mismatches: bad, worstComponentDiffS: worst.comp, worstRateDiff: worst.rate }));
process.exit(bad ? 1 : 0);
