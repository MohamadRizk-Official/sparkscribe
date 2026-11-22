// docs/modules/: every `src/…`, `server/…` or `tests/…` path a module guide names must exist, and every guide
// must be linked from docs/modules/README.md. Keeps the guides honest when files are moved or renamed.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const root = new URL('../', import.meta.url);
const dir = new URL('docs/modules/', root);
const guides = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md');
const readme = readFileSync(new URL('README.md', dir), 'utf8');

ok(guides.length > 20, `there are module guides (${guides.length})`);

const unlinked = guides.filter((g) => !readme.includes(`(${g})`));
ok(unlinked.length === 0, `every guide is linked from the README${unlinked.length ? ' (not linked: ' + unlinked.join(', ') + ')' : ''}`);

const broken = [];
for (const g of [...guides, 'README.md']) {
  const text = readFileSync(new URL(g, dir), 'utf8');
  for (const m of text.matchAll(/`((?:src|server|tests)\/[\w./-]+\.(?:js|mjs))`/g)) {
    if (!existsSync(new URL(m[1], root))) broken.push(`${g}: ${m[1]}`);
  }
}
ok(broken.length === 0, `every source or test path named in the guides exists${broken.length ? ' (missing: ' + broken.join('; ') + ')' : ''}`);

const badLinks = [];
for (const g of guides) {
  const text = readFileSync(new URL(g, dir), 'utf8');
  for (const m of text.matchAll(/\]\(([\w-]+\.md)\)/g)) if (!existsSync(new URL(m[1], dir))) badLinks.push(`${g}: ${m[1]}`);
}
ok(badLinks.length === 0, `links between guides point at existing files${badLinks.length ? ' (' + badLinks.join('; ') + ')' : ''}`);

console.log(`\n${pass} checks passed`);
