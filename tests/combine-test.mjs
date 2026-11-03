// The combined speaker engine (src/engine/combine.js) on small, exact cases: which model decides where, the merged-
// people split, a chosen speaker count, and speech nobody could attribute.   node tests/combine-test.mjs
import assert from 'node:assert/strict';
import { combineSpeakers, shouldCombine, primaryCount } from '../src/engine/combine.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const at = (segs, t) => segs.find((s) => s.start <= t && t < s.end)?.speaker ?? null;
const seg = (start, end, speaker) => ({ start, end, speaker });

// 1. the primary decides where it names exactly one person; labels are translated, renamed in order of appearance
{
  const primary = [seg(0, 10, 'S0'), seg(10, 20, 'S1')];
  const secondary = [seg(0, 9, 'B'), seg(9, 20, 'A')]; // the secondary moves the change 1 s early
  const out = combineSpeakers(primary, secondary, 20);
  ok(at(out, 9.5) === at(out, 5) && at(out, 9.5) === 'SPEAKER_00', 'where the primary names one person, it decides (the secondary\'s early change is ignored)');
  ok(at(out, 15) === 'SPEAKER_01', 'speakers are renamed SPEAKER_00, SPEAKER_01 in order of first appearance');
}
// 2. where the primary names nobody or two people, the secondary decides, translated into the primary's people
{
  const primary = [seg(0, 10, 'S0'), seg(10, 20, 'S1'), seg(12, 14, 'S0')]; // 12-14: both (overlap)
  const secondary = [seg(0, 10, 'X'), seg(10, 25, 'Y')];
  const out = combineSpeakers(primary, secondary, 25);
  ok(at(out, 13) === at(out, 15), 'overlap in the primary: the secondary\'s person (translated) is used');
  ok(at(out, 22) === at(out, 15), 'speech the primary missed: the secondary\'s person (translated) is used');
}
// 3. a primary speaker the secondary consistently divides into two people (each long enough) is split
{
  const primary = [seg(0, 60, 'S0'), seg(60, 120, 'S1')];
  const secondary = [seg(0, 40, 'A'), seg(40, 60, 'C'), seg(60, 120, 'B')]; // S0 is really A then C
  const out = combineSpeakers(primary, secondary, 120);
  ok(at(out, 20) !== at(out, 50) && at(out, 50) !== at(out, 90), 'two people merged by the primary are told apart by the secondary');
  const brief = combineSpeakers(primary, [seg(0, 55, 'A'), seg(55, 60, 'C'), seg(60, 120, 'B')], 120);
  ok(at(brief, 20) === at(brief, 57), 'a short disagreement (under 12 s) does not split a person');
}
// 4. a chosen speaker count: extra people are folded into the right kept person
{
  const primary = [seg(0, 30, 'S0'), seg(30, 60, 'S1'), seg(60, 64, 'S2')]; // S2: 4 s of a "third person"
  const secondary = [seg(0, 30, 'A'), seg(30, 64, 'B')]; // run with 2 speakers
  const auto = combineSpeakers(primary, secondary, 64);
  ok(new Set(auto.map((s) => s.speaker)).size === 3, 'automatic count keeps the primary\'s third person');
  const two = combineSpeakers(primary, secondary, 64, { maxSpeakers: 2 });
  ok(new Set(two.map((s) => s.speaker)).size === 2 && at(two, 62) === at(two, 45), 'with 2 chosen, the extra person is folded into the person the secondary says it is');
}
// 5. speech the secondary marks Unknown is never turned into a person
{
  const primary = [seg(0, 10, 'S0')];
  const secondary = [seg(0, 10, 'A'), seg(10, 14, 'Unknown')];
  const out = combineSpeakers(primary, secondary, 14, { unknown: 'Unknown' });
  ok(at(out, 12) === 'Unknown', 'where only the secondary has speech and calls it Unknown, it stays Unknown');
  ok(!out.some((s) => s.speaker === 'SPEAKER_01'), 'Unknown does not take a SPEAKER_ number');
}
// 6. no overlaps in the output, and nothing outside the recording
{
  const out = combineSpeakers([seg(0, 5, 'S0'), seg(3, 8, 'S1')], [seg(0, 8, 'A')], 8);
  ok(out.every((s, i) => i === 0 || s.start >= out[i - 1].end - 1e-9) && out.at(-1).end <= 8 + 1e-9, 'segments do not overlap and stay inside the recording');
}
// 7. used only with three speakers or fewer (the primary's count of people talking 5 s or more), or as the user chose
{
  const three = [seg(0, 10, 'S0'), seg(10, 20, 'S1'), seg(20, 30, 'S2'), seg(30, 32, 'S3')]; // S3: 2 s only
  ok(primaryCount(three) === 3 && shouldCombine(three), 'three people (and one who says a word) -> combined');
  const four = [...three, seg(32, 40, 'S3')];
  ok(primaryCount(four) === 4 && !shouldCombine(four), 'four people talking 5 s or more -> the first engine alone');
  ok(shouldCombine(four, 2) && !shouldCombine(three, 4), 'a speaker count chosen by the user decides');
}

console.log(`\n${pass} checks passed`);
