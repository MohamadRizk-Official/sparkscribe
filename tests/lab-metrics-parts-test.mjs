// Building blocks of the accuracy lab's speaker metrics (accuracy/lab/metrics.mjs): normalize, evaluatedRegion,
// optimalMapping and standardMetrics. (der / jer / hungarianMax themselves are covered by tests/metrics-test.mjs.)
import assert from 'node:assert/strict';
const M = await import(new URL('../accuracy/lab/metrics.mjs', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const seg = (start, end, label) => ({ start, end, label });

ok(M.METRICS_VERSION === 'lab-metrics-1', 'the metrics version is recorded');

// ---- normalize ----
let n = M.normalize([seg(0, 2, 'A'), seg(1, 3, 'A'), seg(3, 4, 'A')]);
ok(n.length === 1 && n[0].start === 0 && n[0].end === 4, 'overlapping and touching segments of one label merge');
n = M.normalize([seg(0, 2, 'A'), seg(3, 4, 'A')]);
ok(n.length === 2, 'a gap keeps two segments');
n = M.normalize([seg(1, 2, 'B'), seg(0, 3, 'A')]);
ok(n.length === 2 && n[0].label === 'A' && n[1].label === 'B', 'different labels stay apart, sorted by start');
ok(M.normalize([seg(2, 2, 'A'), seg(5, 1, 'A')]).length === 0, 'empty and reversed segments are ignored');

// ---- standardHypothesis ----
const sp = [{ start: 0, end: 5, speaker: 'Hadi' }, { start: 5, end: 7, speaker: 'Unknown' }, { start: 7, end: 9, speaker: 'x', overlap: true, voices: ['Hadi', 'Sara'] }, { start: 9, end: 12, speaker: 'Sara' }];
let h = M.standardHypothesis(sp);
ok(h.length === 2 && h.every((s) => s.label !== 'Unknown'), 'Unknown and overlap stretches are not speakers');
h = M.standardHypothesis(sp, 'Unknown', { namedOverlap: true });
ok(h.length === 3 && h.find((s) => s.label === 'Sara').start === 7 && h.filter((s) => s.start === 7).length === 2, 'with namedOverlap an overlap counts for both known voices (and merges with the same speaker next to it)');
ok(M.standardHypothesis([{ start: 0, end: 1, speaker: '?' }], '?').length === 0, 'the "unknown" label can be changed');

// ---- evaluatedRegion ----
const ref = [seg(0, 10, 'A'), seg(10, 20, 'B')];
ok(M.evaluatedRegion([], []).length === 0, 'with nothing to score the region is empty');
let reg = M.evaluatedRegion(ref, [seg(0, 25, 'x')]);
ok(reg.length === 1 && reg[0][0] === 0 && reg[0][1] === 25, 'the region spans reference and hypothesis');
reg = M.evaluatedRegion(ref, [], { collar: 1 });
ok(reg.length === 2 && near(reg[0][1], 9.5) && near(reg[1][0], 10.5), 'a collar removes half its width either side of each boundary');
ok(near(reg[0][0], 0.5) && near(reg[1][1], 19.5), 'the collar also trims the outer edges');
reg = M.evaluatedRegion([seg(0, 10, 'A'), seg(4, 6, 'B')], [], { skipOverlap: true });
ok(reg.length === 2 && reg[0][1] === 4 && reg[1][0] === 6, 'skipOverlap removes where two reference speakers overlap');
reg = M.evaluatedRegion(ref, [], { uem: [[5, 15]] });
ok(reg.length === 1 && reg[0][0] === 5 && reg[0][1] === 15, 'a given UEM replaces the automatic one');

// ---- optimalMapping ----
const hyp = [seg(0, 9, 'x'), seg(9, 20, 'y')];
const region = M.evaluatedRegion(ref, hyp);
const m = M.optimalMapping(ref, hyp, region);
ok(m.map.get('x') === 'A' && m.map.get('y') === 'B', 'each hypothesis label maps to the reference speaker it overlaps most');
ok(m.refLabels.join() === 'A,B' && m.hypLabels.join() === 'x,y', 'the label lists follow first appearance');
ok(near(m.cooccurrence[0][0], 9) && near(m.cooccurrence[1][1], 10) && near(m.cooccurrence[1][0], 1), 'the co-occurrence matrix holds shared seconds');
const one = M.optimalMapping(ref, [seg(0, 20, 'z')], M.evaluatedRegion(ref, [seg(0, 20, 'z')]));
ok(one.map.size === 1, 'two reference speakers can not both be mapped to one hypothesis label');
ok(M.optimalMapping(ref, [seg(30, 40, 'q')], [[0, 20]]).map.size === 0, 'a hypothesis label that never co-occurs is not mapped');

// ---- standardMetrics ----
const sm = M.standardMetrics(ref, hyp);
ok(near(sm.der.total, 20) && near(sm.der.confusion, 1) && near(sm.der.der, 1 / 20), 'one second in the wrong place is 5% DER');
ok(sm.der.mapping.x === 'A' && sm.der.mapping.y === 'B', 'the DER mapping is reported');
ok(sm.derCollar025.der <= sm.der.der + 1e-9, 'a collar never makes the DER worse here');
ok(sm.derNoOverlap.total === 20, 'without overlapping reference speech nothing is skipped');
ok(typeof sm.jer === 'number' && sm.jer > 0 && sm.jer < 0.2, 'JER is a small positive number for a near match');
ok(Object.keys(sm.jerPerSpeaker).join() === 'A,B', 'JER is given for each reference speaker');
const perfect = M.standardMetrics(ref, [seg(0, 10, 'p'), seg(10, 20, 'q')]);
ok(perfect.der.der === 0 && perfect.jer === 0, 'a perfect hypothesis scores zero, whatever it calls its speakers');
ok(sm.protocol.includes('pyannote.metrics'), 'the protocol is named in the output');

console.log(`${pass} checks passed`);
