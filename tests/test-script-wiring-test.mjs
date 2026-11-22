// Repo hygiene: every tests/*-test.mjs file is listed in the "test" script of package.json exactly once, and every
// file the script names exists. A test that is not wired in never runs in CI.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const root = new URL('../', import.meta.url);
const script = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).scripts.test;
const listed = [...script.matchAll(/node (tests\/[\w.-]+\.mjs)/g)].map((m) => m[1]);

ok(listed.length > 50, `the test script lists many files (${listed.length})`);
ok(new Set(listed).size === listed.length, 'no test file is listed twice');
ok(listed.every((f) => existsSync(new URL(f, root))), 'every listed file exists');

const files = readdirSync(new URL('tests/', root)).filter((f) => f.endsWith('-test.mjs'));
const missing = files.filter((f) => !listed.includes(`tests/${f}`));
ok(missing.length === 0, `every *-test.mjs file is wired into npm test${missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''}`);

ok(script.split('&&').every((part) => /^\s*node tests\/[\w.-]+\.mjs\s*$/.test(part)), 'the script is a plain chain of "node tests/<file>.mjs" commands');

console.log(`\n${pass} checks passed`);
