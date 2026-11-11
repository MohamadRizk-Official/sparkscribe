// A course's accent colour (src/lib/course-tone.js): stable, one of five palette tones.
import assert from 'node:assert/strict';
const { courseTone } = await import(new URL('../src/lib/course-tone.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const TONES = ['cyan', 'violet', 'amber', 'blue', 'magenta'];

ok(courseTone('course-1') === courseTone('course-1'), 'the same id always gives the same tone');
ok(TONES.includes(courseTone('anything')), 'the tone is one of the five palette tones');
ok(TONES.includes(courseTone('')), 'an empty id still gives a valid tone');
ok(TONES.includes(courseTone(12345)) && courseTone(12345) === courseTone('12345'), 'numbers behave like their string form');
ok(TONES.includes(courseTone(null)) && TONES.includes(courseTone(undefined)), 'null and undefined do not throw');

const seen = new Set();
for (let i = 0; i < 200; i++) seen.add(courseTone(`id-${i}`));
ok(seen.size === TONES.length, 'across many ids all five tones are used');

const counts = Object.fromEntries(TONES.map((t) => [t, 0]));
for (let i = 0; i < 1000; i++) counts[courseTone(`uuid-${i}`)]++;
ok(Object.values(counts).every((n) => n > 100), 'tones are spread out (none under 10% of 1000 ids)');
ok(courseTone('abc') === 'violet', 'a known id keeps its tone (guards against changing the hash)');

console.log(`${pass} checks passed`);
