// Citations in Ask-across answers (server/ai/across.js: parseCites, groundAcross) at their edges: which brackets are
// read as citations, which cited lines survive, and how the text is tidied when a citation is dropped.
import assert from 'node:assert/strict';
const X = await import(new URL('../server/ai/across.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); pass++; console.log('ok -', m); };
const allowed = new Map([['R1', new Set([0, 1, 2])], ['R2', new Set([5])]]);
const refsOf = (t) => X.groundAcross(t, allowed).refs.map((r) => `${r.label}:${r.line}`).join();

// ---- parseCites
eq(X.parseCites('R1:2'), [{ label: 'R1', line: 2 }], 'one citation');
eq(X.parseCites('R1:2, 3, 4'), [{ label: 'R1', line: 2 }, { label: 'R1', line: 3 }, { label: 'R1', line: 4 }], 'bare numbers continue the last recording');
eq(X.parseCites('R1:2; R2:5, 6'), [{ label: 'R1', line: 2 }, { label: 'R2', line: 5 }, { label: 'R2', line: 6 }], 'a new label takes over from there on');
eq(X.parseCites('3, R1:4'), [{ label: 'R1', line: 4 }], 'a bare number before any label has nothing to belong to and is skipped');
eq(X.parseCites(''), [], 'an empty group has no citations');
eq(X.parseCites('R1:x, R1:2'), [{ label: 'R1', line: 2 }], 'a part that is not a line number is skipped');
eq(X.parseCites('  R1:2 ,   R1:3  '), [{ label: 'R1', line: 2 }, { label: 'R1', line: 3 }], 'spaces around parts are ignored');
eq(X.parseCites('R12:300'), [{ label: 'R12', line: 300 }], 'labels and lines can have several digits');

// ---- groundAcross: which brackets count
eq(refsOf('Yes [R1:1].'), 'R1:1', 'a valid citation is kept');
eq(refsOf('See [1] and [R1] and [R1:] and [x:1].'), '', 'brackets that are not a recording label plus a line are not citations at all');
ok(X.groundAcross('See [1] and [R1].', allowed).answer === 'See [1] and [R1].', '…and they are left in the text untouched');
eq(refsOf('Case [r1:1].'), '', 'labels are upper-case R only');
eq(refsOf('Both [R1:1, R2:5] ok.'), 'R1:1,R2:5', 'one bracket may cite two recordings');
eq(refsOf('Twice [R1:1] and again [R1:1, R1:1].'), 'R1:1', 'a line cited several times is listed once');
eq(refsOf('Order [R2:5] then [R1:0].'), 'R2:5,R1:0', 'references keep the order of first appearance');

// ---- groundAcross: what is dropped, counted and tidied
const g = X.groundAcross('Made up [R1:99].', allowed);
ok(g.invalid === 1 && g.refs.length === 0 && g.answer === 'Made up.', 'a citation of a line that was not given is removed and counted');
const mixed = X.groundAcross('Half [R1:1, R1:99, R3:1].', allowed);
ok(mixed.answer === 'Half [R1:1].' && mixed.invalid === 2, 'the bad parts of a bracket go, the good part stays, and each bad part is counted');
const unknownRec = X.groundAcross('Nope [R9:1].', allowed);
ok(unknownRec.invalid === 1 && unknownRec.refs.length === 0, 'a recording that is not in the collection cannot be cited');
ok(X.groundAcross('Space before [R9:1] .', allowed).answer === 'Space before.', 'the space left in front of punctuation is tidied');
ok(X.groundAcross('A [R9:1] , b', allowed).answer === 'A, b', 'a comma left after a removed citation is tidied too');
ok(X.groundAcross('  padded [R1:0]  ', allowed).answer === 'padded [R1:0]', 'the answer is trimmed');
ok(X.groundAcross('Same [ R1:1 ]', allowed).answer === 'Same [ R1:1 ]', 'a bracket with inner spaces is not a citation');
ok(X.groundAcross('Normalised [R1:1;R1:2].', allowed).answer === 'Normalised [R1:1, R1:2].', 'kept citations are rewritten as "R1:1, R1:2"');
const empty = X.groundAcross(null, allowed);
ok(empty.answer === '' && empty.refs.length === 0 && empty.invalid === 0, 'no text gives an empty answer');
ok(X.groundAcross(undefined, allowed).answer === '' && X.groundAcross(42, allowed).answer === '42', 'undefined is empty and a number is turned into text');
ok(X.groundAcross('Nothing [R1:1].', new Map()).invalid === 1, 'with nothing allowed every citation is invalid');

console.log(`\n${pass} checks passed`);
