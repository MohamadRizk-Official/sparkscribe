// Speaker names in AI results after a rename (src/lib/speaker-names.js): name map and plain-text renaming.
import assert from 'node:assert/strict';
const { nameMapFromSegments, renameInText } = await import(new URL('../src/lib/speaker-names.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

// ---- nameMapFromSegments ----
let m = nameMapFromSegments([
  { orig: 'Speaker 1', speaker: 'Hadi' }, { orig: 'Speaker 1', speaker: 'Hadi' },
  { orig: 'Speaker 2', speaker: 'Speaker 2' },
]);
ok(m.size === 1 && m.get('Speaker 1') === 'Hadi', 'a renamed speaker maps old name to new');
ok(!m.has('Speaker 2'), 'an unchanged speaker is not in the map');

m = nameMapFromSegments([{ orig: 'Speaker 3', speaker: 'A' }, { orig: 'Speaker 3', speaker: 'B' }]);
ok(m.size === 0, 'an ambiguous rename (split 50/50) is left out');

m = nameMapFromSegments([
  ...Array(7).fill({ orig: 'Speaker 1', speaker: 'Maya' }),
  ...Array(3).fill({ orig: 'Speaker 1', speaker: 'Sam' }),
]);
ok(m.get('Speaker 1') === 'Maya', 'a 70% majority is enough to decide the name');
m = nameMapFromSegments([
  ...Array(6).fill({ orig: 'Speaker 1', speaker: 'Maya' }),
  ...Array(4).fill({ orig: 'Speaker 1', speaker: 'Sam' }),
]);
ok(m.size === 0, 'a 60% majority is not enough');

m = nameMapFromSegments([{ orig: 'Unknown', speaker: 'Hadi' }, { orig: 'Speaker 1', speaker: 'Unknown' }, { orig: '', speaker: 'X' }, { speaker: 'Y' }, { orig: 'Speaker 4' }]);
ok(m.size === 0, 'Unknown, missing originals and missing names never produce a mapping');
ok(nameMapFromSegments(null).size === 0 && nameMapFromSegments([]).size === 0, 'no segments gives an empty map');

// ---- renameInText ----
const map = new Map([['Speaker 1', 'Hadi'], ['Speaker 2', 'Maya Lee']]);
ok(renameInText('Speaker 1 asked, Speaker 2 answered.', map) === 'Hadi asked, Maya Lee answered.', 'every old name is replaced');
ok(renameInText('Speaker 10 and Speaker 1', map) === 'Speaker 10 and Hadi', 'whole names only: Speaker 1 does not touch Speaker 10');
ok(renameInText('(Speaker 1)', map) === '(Hadi)', 'names inside punctuation are replaced');
ok(renameInText('xSpeaker 1', map) === 'xSpeaker 1', 'a name glued to a letter is not replaced');
ok(renameInText('Nothing to change', map) === 'Nothing to change', 'text without names is unchanged');
ok(renameInText('Speaker 1', new Map()) === 'Speaker 1', 'an empty map leaves text unchanged');
ok(renameInText(12, map) === '12', 'with a non-empty map, non-string input is converted to text');
ok(renameInText('A.B. said hi', new Map([['A.B.', 'Ann']])) === 'Ann said hi', 'regex characters in names are matched literally');
ok(renameInText('Speaker 1 Speaker 1', map) === 'Hadi Hadi', 'repeated names are all replaced');

console.log(`${pass} checks passed`);
