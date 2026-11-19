// When the two speaker engines are combined (src/engine/combine.js): primaryCount counts people who really talk, and
// shouldCombine allows up to COMBINE_MAX_SPEAKERS of them (or the number the person chose).
//   node tests/combine-gate-test.mjs
import assert from 'node:assert/strict';
import { COMBINE_MAX_SPEAKERS, primaryCount, shouldCombine } from '../src/engine/combine.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

const turn = (speaker, start, end) => ({ speaker, start, end });
ok(COMBINE_MAX_SPEAKERS === 3, 'combining is allowed for up to three speakers');
ok(primaryCount([]) === 0, 'no turns: nobody talks');
ok(primaryCount([turn('A', 0, 10), turn('B', 10, 20)]) === 2, 'two people with 10 s each are two speakers');
ok(primaryCount([turn('A', 0, 10), turn('B', 10, 12)]) === 1, 'a speaker under 5 s in total is not counted');
ok(primaryCount([turn('A', 0, 3), turn('A', 10, 13)]) === 1, 'a speaker\'s turns add up (3 s + 3 s passes the 5 s bar)');
ok(primaryCount([turn('A', 0, 5)]) === 1, 'exactly 5 s counts');
const four = ['A', 'B', 'C', 'D'].map((s, i) => turn(s, i * 10, i * 10 + 8));
ok(primaryCount(four) === 4 && shouldCombine(four) === false, 'four real speakers: not combined');
ok(shouldCombine(four.slice(0, 3)) === true, 'three real speakers: combined');
ok(shouldCombine([]) === true, 'no speakers at all: nothing blocks combining');
ok(shouldCombine(four, 2) === true && shouldCombine(four, 3) === true, 'a chosen count of 3 or fewer is combined whatever the audio says');
ok(shouldCombine(four.slice(0, 2), 4) === false, 'a chosen count above 3 is not combined even if only two people were heard');
console.log(`\n${pass} checks passed`);
