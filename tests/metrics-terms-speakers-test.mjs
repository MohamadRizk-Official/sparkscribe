// Key-term recall and word-level speaker attribution (src/lib/metrics.js termRecall, speakerAttribution).
import assert from 'node:assert/strict';
import { termRecall, speakerAttribution } from '../src/lib/metrics.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 1e-9, `${m}: ${a} vs ${b}`); pass++; console.log('ok -', m); };

// ---- termRecall
let t = termRecall(['mitochondria', 'ATP'], 'The Mitochondria make ATP, mostly.');
ok(t.found === 2 && t.total === 2 && t.missing.length === 0, 'terms are found whatever the case or punctuation');
t = termRecall(['mitochondria', 'ribosome'], 'only mitochondria today');
ok(t.found === 1 && t.total === 2 && t.missing[0] === 'ribosome', 'a term that was not said is listed as missing');
t = termRecall(['cell'], 'the cellular wall');
ok(t.found === 0, 'a term must match whole words ("cell" is not found in "cellular")');
t = termRecall(['cell wall'], 'The Cell, wall and membrane');
ok(t.found === 1, 'a two-word term matches across punctuation');
t = termRecall(['', '  ', '...'], 'anything');
ok(t.total === 0 && t.found === 0, 'blank terms are not counted');
t = termRecall([], 'anything');
ok(t.total === 0 && t.missing.length === 0, 'no terms, nothing to find');
t = termRecall(['x'], '');
ok(t.found === 0 && t.missing[0] === 'x', 'an empty hypothesis finds nothing');

// ---- speakerAttribution
const ref = [{ speaker: 'A', text: 'good morning everyone' }, { speaker: 'B', text: 'thanks for coming' }];
let s = speakerAttribution(ref, [{ speaker: 'S1', text: 'good morning everyone' }, { speaker: 'S2', text: 'thanks for coming' }]);
near(s.wder, 0, 'every word given to the right person (whatever the label names): WDER 0');
ok(s.words === 6 && s.errors === 0 && s.hypSpeakers === 2 && s.refSpeakers === 2, '…six aligned words, two speakers each side');
ok(s.falseChanges === 0 && s.missedChanges === 0 && s.unknownWords === 0, '…and no false or missed changes');

s = speakerAttribution(ref, [{ speaker: 'S1', text: 'good morning everyone thanks for coming' }]);
near(s.wder, 0.5, 'one speaker for two people: the smaller half of the words is wrong');
ok(s.missedChanges === 1 && s.hypSpeakers === 1, '…and the change between them was missed');

s = speakerAttribution(ref, [{ speaker: 'S1', text: 'good morning' }, { speaker: 'S2', text: 'everyone thanks for coming' }]);
ok(s.errors === 1 && s.words === 6, 'the boundary placed one word early: one wrong word');
ok(s.falseChanges === 1 && s.missedChanges === 1, '…which is one false change and one missed change');

s = speakerAttribution(ref, [{ speaker: 'Unknown', text: 'good morning everyone' }, { speaker: 'S2', text: 'thanks for coming' }]);
ok(s.unknownWords === 3 && s.errors === 3, 'words with speaker "Unknown" are errors and are counted as unknown');
near(s.wder, 0.5, '…half of the words');
ok(s.hypSpeakers === 1, '"Unknown" is not counted as a speaker');

s = speakerAttribution(ref, [{ speaker: 'S1', text: 'good morning everyone thanks for coming' }].slice(0, 0));
ok(s.words === 0 && s.wder === 0, 'an empty hypothesis has no aligned words and WDER 0');

s = speakerAttribution([{ speaker: 'A', text: 'one two three' }], [{ speaker: 'X', text: 'one two three' }]);
near(s.wder, 0, 'a single speaker is mapped to its only partner');
ok(s.refSpeakers === 1, '…one reference speaker');

console.log(`${pass} checks passed`);
