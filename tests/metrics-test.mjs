// Speaker metrics (accuracy/lab/metrics.mjs) on hand-computed cases. The full comparison with pyannote.metrics is
// accuracy/lab/crosscheck.mjs (needs a Python environment); these run with Node alone.
import assert from 'node:assert/strict';
import { der, jer, standardHypothesis, hungarianMax } from '../accuracy/lab/metrics.mjs';

let pass = 0;
const S = (start, end, label) => ({ start, end, label });
const near = (a, b, msg) => { assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`); pass++; console.log('ok -', msg); };

// perfect, with other label names
near(der([S(0, 5, 'A'), S(5, 9, 'B')], [S(0, 5, 'x'), S(5, 9, 'y')]).der, 0, 'perfect match = 0');
// one label for two people: 4 s of B's 9 s total is confusion
near(der([S(0, 5, 'A'), S(5, 9, 'B')], [S(0, 9, 'x')]).der, 4 / 9, 'one label for two people');
// false alarm in silence: 2 s over 5 s of speech
near(der([S(0, 5, 'A')], [S(0, 5, 'x'), S(7, 9, 'x')]).der, 2 / 5, 'false alarm in silence');
// reference overlap 4–6 s counts both people: total 12 s; hyp gives one label there -> 2 s missed
{ const r = der([S(0, 6, 'A'), S(4, 10, 'B')], [S(0, 5, 'x'), S(5, 10, 'y')]); near(r.total, 12, 'overlap counted twice in total'); near(r.missed, 2, 'one label in overlap = missed second person'); }
// collar 0.5 = 0.25 s each side of every reference boundary
near(der([S(0, 10, 'A')], [S(0, 9, 'x')], { collar: 0.5 }).total, 9.5, 'collar is total width, half each side');
// skipOverlap removes the overlapped region from scoring
near(der([S(0, 6, 'A'), S(4, 10, 'B')], [S(0, 10, 'x')], { skipOverlap: true }).total, 8, 'skip overlap removes it');
// non-greedy mapping: x covers A for 6 s and B for 6 s, y covers A for 4 s -> best is x->B, y->A
near(der([S(0, 10, 'A'), S(10, 16, 'B')], [S(0, 6, 'x'), S(6, 10, 'y'), S(10, 16, 'x')]).confusion, 6, 'optimal (non-greedy) mapping');
// JER: unmapped reference speaker counts 1.0
near(jer([S(0, 5, 'A'), S(5, 10, 'B')], [S(0, 10, 'x')]).jer, (0.5 + 1) / 2, 'JER with an unmapped person');
// Unknown and overlap-marked output are not speakers in the standard hypothesis
{
  const hyp = standardHypothesis([{ start: 0, end: 4, speaker: 'S1' }, { start: 4, end: 6, speaker: 'Unknown' }, { start: 6, end: 8, speaker: 'Unknown', overlap: true }]);
  assert.deepEqual(hyp.map((s) => s.label), ['S1']); pass++; console.log('ok - Unknown / overlap left out of the standard hypothesis');
  near(der([S(0, 8, 'A')], hyp).missed, 4, 'Unknown time counts as missed speech');
}
// Hungarian on a rectangular matrix
{ const m = hungarianMax([[1, 9], [8, 2], [3, 3]]); assert.equal(m.get(0), 1); assert.equal(m.get(1), 0); assert.ok(!m.has(2)); pass++; console.log('ok - hungarian, rectangular'); }

console.log(`\n${pass} passed`);
