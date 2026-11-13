// The stored (compact) segment form in src/lib/segments.js: toStoredSegments, segmentsToStored, normalizeRecordingType.
import assert from 'node:assert/strict';
const S = await import(new URL('../src/lib/segments.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

const lines = [{ start: 1.236, end: 4.5, speaker: 'sp0', text: 'Hello there.' }, { start: 5, end: 6.004, speaker: 'sp1', text: 'Hi.' }];
const names = { sp0: 'Dana', sp1: 'Speaker 2' };
const origs = { sp0: 'Speaker 1', sp1: 'Speaker 2' };
const stored = S.toStoredSegments(lines, (id) => names[id], (id) => origs[id]);
ok(stored[0].s === 1.24 && stored[0].e === 4.5, 'times are rounded to 2 decimals');
ok(stored[1].e === 6, '6.004 rounds to 6');
ok(stored[0].sp === 'Dana' && stored[0].t === 'Hello there.', 'the display name and text are kept');
ok(stored[0].o === 'Speaker 1', 'a renamed speaker keeps its first label in o');
ok(!('o' in stored[1]), 'an unrenamed speaker has no o');
ok(!('o' in S.toStoredSegments(lines, (id) => names[id])[0]), 'without an origOf there is no o');

const back = S.segmentsToStored([{ start: 2.555, end: 3, speaker: 'Dana', text: 'x', orig: 'Speaker 1' }, { start: 3, end: 4, speaker: 'Lee', text: 'y', orig: 'Lee' }]);
ok(back[0].s === 2.56 && back[0].o === 'Speaker 1', 'segmentsToStored keeps a differing original label');
ok(!('o' in back[1]), '…and drops it when it equals the speaker');

ok(S.RECORDING_TYPES.includes('lecture') && S.RECORDING_TYPES[0] === 'general', 'general is the first recording type');
ok(S.RECORDING_TYPES.every((t) => typeof S.RECORDING_TYPE_LABEL[t] === 'string'), 'every recording type has a label');
ok(S.normalizeRecordingType('podcast') === 'podcast', 'a known type is kept');
ok(S.normalizeRecordingType('nonsense') === 'general' && S.normalizeRecordingType(undefined) === 'general', 'an unknown or missing type becomes general');
ok(S.RECORDING_TYPE_LABEL.voice_message === 'Voice Message', 'voice_message is labelled "Voice Message"');

console.log(`${pass} checks passed`);
