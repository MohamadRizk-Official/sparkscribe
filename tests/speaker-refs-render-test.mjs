// Showing speaker codes (src/lib/speaker-refs.js): hasTokens, codedLine, renderSpeakers, origCodes / origResolver.
import assert from 'node:assert/strict';
const R = await import(new URL('../src/lib/speaker-refs.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); pass++; console.log('ok -', msg); };

const segs = [
  { id: 0, speaker: 'Dana', orig: 'Speaker 1', text: 'a b c', start: 0 },
  { id: 1, speaker: 'Lee', orig: 'Speaker 2', text: 'd', start: 5 },
  { id: 2, speaker: 'Dana', orig: 'Speaker 1', text: 'e', start: 9 },
];
const { table, codeOf } = R.speakerTable(segs);

ok(R.hasTokens('{{S1}} said it') && R.hasTokens('{{ S12 }}'), 'hasTokens finds {{S1}} with or without inner spaces');
ok(!R.hasTokens('S1 said it') && !R.hasTokens('{{R1}}') && !R.hasTokens(null) && !R.hasTokens(5), 'hasTokens ignores bare codes, recording labels and non-strings');

ok(R.codedLine(segs[1], codeOf, (t) => `0:0${t}`) === '[1] 0:05 S2: d', 'codedLine shows the code, not the name');
ok(R.codedLine({ id: 3, speaker: 'Unknown', text: 'x', start: 0 }, codeOf, () => '0:00') === '[3] 0:00 Unknown: x', 'a speaker with no code keeps "Unknown"');

const resolve = R.speakerResolver(table, segs);
ok(R.renderSpeakers('{{S1}} and {{ S2 }}', resolve) === 'Dana and Lee', 'renderSpeakers swaps codes for current names');
ok(R.renderSpeakers('{{S9}} spoke', resolve) === 'a speaker spoke', 'an unknown code shows "a speaker"');
ok(R.renderSpeakers(5, resolve) === 5 && R.renderSpeakers(undefined, resolve) === undefined, 'non-strings pass through unchanged');

eq([...R.origCodes(segs)], [['Speaker 1', 'S1'], ['Speaker 2', 'S2']], 'origCodes numbers speakers by their original label');
const now = R.origResolver(segs);
ok(now('S1') === 'Dana' && now('S2') === 'Lee', 'origResolver gives the name each original speaker has now');
ok(now('S7') === 'a speaker', 'origResolver: a code that was never issued is "a speaker"');

console.log(`${pass} checks passed`);
