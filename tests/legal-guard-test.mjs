// The legal pages are published final (scripts/build-legal.mjs --final), and a production build refuses draft pages
// (vite.config.js legal-final-guard): checked both ways by building the drafts, trying a production build, then
// restoring the final pages and building again.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const root = new URL('../', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');
const node = (args, env = {}) => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
const prodBuild = () => node(['node_modules/vite/bin/vite.js', 'build', '--outDir', 'qa/out/legal-guard-dist', '--emptyOutDir', '--logLevel', 'error'], { REQUIRE_FINAL_LEGAL: '1' });

const published = { privacy: read('privacy.html'), terms: read('terms.html') };
ok(!/legal-banner|legal-flag/.test(published.privacy + published.terms) && !/\(draft\)/.test(published.privacy + published.terms), 'the published pages are final: no draft banner, no review notes');
ok(/Effective date:<\/strong> \w+ \d+, \d{4}/.test(published.privacy) && /Effective date:<\/strong> \w+ \d+, \d{4}/.test(published.terms), 'both state their effective date');
const fin = node(['scripts/build-legal.mjs', '--final']);
ok(fin.status === 0 && read('privacy.html') === published.privacy && read('terms.html') === published.terms, '--final reproduces exactly what is published (the source has no open notes)');

// a draft must never reach a production build
node(['scripts/build-legal.mjs']);
ok(/legal-banner/.test(read('privacy.html')), 'draft build: pages carry the Draft banner');
const refused = prodBuild();
ok(refused.status !== 0 && /Production build stopped/.test(refused.stderr + refused.stdout), 'a production build refuses draft pages');
node(['scripts/build-legal.mjs', '--final']);
ok(read('privacy.html') === published.privacy && read('terms.html') === published.terms, 'final pages restored');
const built = prodBuild();
ok(built.status === 0, 'a production build with the final pages succeeds');
console.log(`\n${pass} checks passed`);
