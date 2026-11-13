// Stable codes for Ask answers (src/lib/speaker-refs.js origCodes / origResolver / renderAskSpeakers)
// and the transcript fingerprint (transcriptBasis / sameBasis).
import assert from 'node:assert/strict';
const R = await import(new URL('../src/lib/speaker-refs.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); pass++; console.log('ok -', msg); };
const line = (id, speaker, orig, text = 'w') => ({ id, speaker, orig, text, start: id });

// ---- origCodes
eq([...R.origCodes([line(0, 'A', 'Speaker 2'), line(1, 'B', 'Speaker 1')])], [['Speaker 2', 'S2'], ['Speaker 1', 'S1']], 'an automatic "Speaker N" label is always SN, whatever order the lines are in');
eq([...R.origCodes([line(0, 'Ann', 'Ann'), line(1, 'Bob', 'Speaker 1'), line(2, 'Cy', 'Cy')])], [['Speaker 1', 'S1'], ['Ann', 'S2'], ['Cy', 'S3']], 'any other original label takes the next free number, in order of first appearance');
eq([...R.origCodes([line(0, 'x', 'Unknown')])], [], 'Unknown gets no code');
eq([...R.origCodes([])], [], 'no segments, no codes');
eq([...R.origCodes([{ id: 0, speaker: 'Zed', text: 'a' }])], [['Zed', 'S1']], 'a line with no orig uses its speaker as the original label');

// ---- origResolver / renderAskSpeakers
const segs = [line(0, 'Dana', 'Speaker 1'), line(1, 'Dana', 'Speaker 1'), line(2, 'Lee', 'Speaker 1'), line(3, 'Unknown', 'Speaker 2')];
const name = R.origResolver(segs);
ok(name('S1') === 'Dana', 'a code resolves to the name most of that original speaker\'s lines carry now');
ok(name('S2') === 'an unidentified speaker', 'an original speaker whose lines are all Unknown now is "an unidentified speaker"');
ok(name('S9') === 'a speaker', 'a code that was never issued is "a speaker"');
ok(R.renderAskSpeakers('{{S1}} said it', segs) === 'Dana said it', 'renderAskSpeakers swaps {{S1}} for the current name');
ok(R.renderAskSpeakers('{{S1}} said; then {{S2', segs) === 'Dana said; then ', 'an unfinished code at the end of streaming text is hidden');
ok(R.renderAskSpeakers('{{S1}} and {{S', segs) === 'Dana and ', '…also when only "{{S" has arrived');
ok(R.renderAskSpeakers(null, segs) === '', 'null text renders as an empty string');

// ---- transcriptBasis / sameBasis
const base = R.transcriptBasis([line(0, 'A', 'Speaker 1', 'hello world'), line(1, 'B', 'Speaker 2', 'bye')]);
ok(base.n === 2 && /^[0-9a-f]{8}$/.test(base.text) && /^[0-9a-f]{8}$/.test(base.parts), 'the basis is a line count plus two 8-digit hex hashes');
const renamed = R.transcriptBasis([line(0, 'Ann', 'Speaker 1', 'hello  world'), line(1, 'Bob', 'Speaker 2', ' bye ')]);
ok(R.sameBasis(base, renamed), 'renaming speakers and changing whitespace does not change the basis');
ok(!R.sameBasis(base, R.transcriptBasis([line(0, 'A', 'Speaker 1', 'hello there'), line(1, 'B', 'Speaker 2', 'bye')])), 'changing a word changes the basis');
ok(!R.sameBasis(base, R.transcriptBasis([line(0, 'A', 'Speaker 1', 'hello world'), line(1, 'A', 'Speaker 2', 'bye')])), 'giving two lines to the same speaker changes the basis');
ok(!R.sameBasis(base, R.transcriptBasis([line(0, 'A', 'Speaker 1', 'hello world')])), 'a different number of lines changes the basis');
ok(!R.sameBasis(null, base) && !R.sameBasis(base, undefined), 'a missing basis is never the same');
ok(R.transcriptBasis(null).n === 0, 'no segments gives an empty basis');

console.log(`${pass} checks passed`);
