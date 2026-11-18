// The tuned limits in src/engine/voice-guard.js: sample lengths and the voice-matching threshold. They must stay
// consistent with each other (a sample cannot be shorter than its own maximum, a threshold is a cosine in 0..1).
//   node tests/voice-guard-constants-test.mjs
import assert from 'node:assert/strict';
import { SAMPLE_MIN_S, SAMPLE_MAX_S, SAMPLES_PER_SPEAKER, SAME_VOICE, MAX_PEOPLE, MIN_TALK_S } from '../src/engine/voice-guard.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

ok(SAMPLE_MIN_S > 0 && SAMPLE_MIN_S < SAMPLE_MAX_S, 'the shortest sample is positive and shorter than the longest');
ok(SAMPLE_MIN_S === 1 && SAMPLE_MAX_S === 4, 'samples are 1 to 4 seconds');
ok(Number.isInteger(SAMPLES_PER_SPEAKER) && SAMPLES_PER_SPEAKER === 8, 'eight samples per speaker');
ok(SAME_VOICE > 0 && SAME_VOICE < 1, 'the same-voice threshold is a similarity strictly between 0 and 1');
ok(Number.isInteger(MAX_PEOPLE) && MAX_PEOPLE >= 2, 'at least two people can be compared');
ok(MIN_TALK_S >= SAMPLE_MIN_S, 'a speaker must talk at least as long as one minimum sample');
ok(MIN_TALK_S === 5 && MAX_PEOPLE === 4 && SAME_VOICE === 0.6, 'tuned values: 5 s of talk, 4 people, 0.6 similarity');
console.log(`\n${pass} checks passed`);
