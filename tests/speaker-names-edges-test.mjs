// lib/speaker-names.js: when a rename is applied to AI results, and that only whole names are replaced.
import assert from 'node:assert/strict';
import { nameMapFromSegments, renameInText } from '../src/lib/speaker-names.js';

let pass = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); pass++; console.log('ok -', m); };
const seg = (orig, speaker, n = 1) => Array.from({ length: n }, () => ({ orig, speaker }));

eq([...nameMapFromSegments(null)], [], 'no segments give an empty map');
eq([...nameMapFromSegments([{ speaker: 'Hadi' }, { orig: 'Unknown', speaker: 'Hadi' }, { orig: 'Speaker 1' }])], [], 'lines without an original label, an Unknown original or a current name are ignored');
eq([...nameMapFromSegments(seg('Speaker 1', 'Hadi', 3))], [['Speaker 1', 'Hadi']], 'a consistent rename is mapped');
eq([...nameMapFromSegments(seg('Speaker 1', 'Speaker 1', 3))], [], 'an unchanged name is not mapped');
eq([...nameMapFromSegments([...seg('Speaker 1', 'Hadi', 7), ...seg('Speaker 1', 'Sam', 3)])], [['Speaker 1', 'Hadi']], 'a rename with 70% of the lines is applied');
eq([...nameMapFromSegments([...seg('Speaker 1', 'Hadi', 6), ...seg('Speaker 1', 'Sam', 4)])], [], 'a rename below 70% is ambiguous and left alone');
eq([...nameMapFromSegments(seg('Speaker 2', 'Unknown', 4))], [], 'a change to Unknown is never applied');
eq([...nameMapFromSegments([...seg('Speaker 1', 'Hadi', 2), ...seg('Speaker 2', 'Maya', 2)])].length, 2, 'each speaker is handled on its own');

const map = new Map([['Speaker 1', 'Hadi'], ['Speaker 10', 'Noor']]);
eq(renameInText('Speaker 1 said hi. Speaker 10 replied.', map), 'Hadi said hi. Noor replied.', 'the longer name is matched first, so Speaker 10 is not read as Speaker 1');
eq(renameInText('Speaker 12 spoke', map), 'Speaker 12 spoke', 'a name that merely starts with a mapped name is left alone');
eq(renameInText('(Speaker 1)', map), '(Hadi)', 'punctuation around a name is fine');
eq(renameInText('XSpeaker 1', map), 'XSpeaker 1', 'a name inside a longer word is left alone');
eq(renameInText('Speaker 1', new Map()), 'Speaker 1', 'an empty map returns the text unchanged');
eq(renameInText('a.b says', new Map([['a.b', 'Zed']])), 'Zed says', 'regular-expression characters in a name are taken literally');
eq(renameInText('axb says', new Map([['a.b', 'Zed']])), 'axb says', '…and do not match other text');
console.log(`${pass} checks passed`);
