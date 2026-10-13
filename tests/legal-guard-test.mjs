// The draft legal pages can't be published as final while review notes or placeholders remain
// (scripts/build-legal.mjs --final), and a production build refuses draft pages (vite.config.js legal-final-guard).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const root = new URL('../', import.meta.url);
const before = readFileSync(new URL('privacy.html', root), 'utf8');
const r = spawnSync(process.execPath, ['scripts/build-legal.mjs', '--final'], { cwd: root, encoding: 'utf8' });
ok(r.status === 1 && /Not final yet/.test(r.stderr) && /review note/.test(r.stderr), '--final refuses while [CONFIRM]/[LEGAL REVIEW] notes or placeholders remain');
ok(readFileSync(new URL('privacy.html', root), 'utf8') === before, '…and writes nothing');
ok(/legal-banner/.test(before) && /\(draft\)/.test(before), 'the published pages are marked as drafts');
const cfg = readFileSync(new URL('vite.config.js', root), 'utf8');
ok(/legal-final-guard/.test(cfg) && /VERCEL_ENV !== 'production'/.test(cfg), 'production builds check the legal pages (vite.config.js)');
console.log(`\n${pass} checks passed`);
