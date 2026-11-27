// The site's HTML pages (read-only): every page that the build lists has the basics a browser and a screen reader
// need (doctype, language, viewport, a title, a main landmark and one h1), loads a script that exists, and uses no
// inline event handler attributes (the report-only security policy would flag them).
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const root = fileURLToPath(new URL('../', import.meta.url));
const cfg = readFileSync(join(root, 'vite.config.js'), 'utf8');
const pages = [...cfg.matchAll(/:\s*'([\w/-]+\.html)'/g)].map((m) => m[1]).filter((p) => p !== 'mascot-lab.html');
ok(pages.length >= 14, `pages to check (${pages.length})`);

for (const page of pages) {
  const html = readFileSync(join(root, page), 'utf8');
  ok(/^\s*<!doctype html>/i.test(html), `${page}: starts with a doctype`);
  ok(/<html[^>]*\slang="en"/.test(html), `${page}: declares lang="en"`);
  ok(/<meta\s+name="viewport"\s+content="[^"]*width=device-width/.test(html), `${page}: has a mobile viewport`);
  ok((html.match(/<title>[^<]{3,}<\/title>/g) || []).length === 1, `${page}: has exactly one non-empty title`);
  ok(/<main[\s>]/.test(html), `${page}: has a main landmark`);
  ok((html.match(/<h1[\s>]/g) || []).length >= 1, `${page}: has a top-level heading`);
  const scripts = [...html.matchAll(/<script[^>]*\ssrc="(\/src\/[^"]+)"/g)].map((m) => m[1]);
  ok(scripts.length >= 1 && scripts.every((s) => existsSync(join(root, s.slice(1)))), `${page}: loads an existing module (${scripts.join(', ')})`);
  ok(!/\s on(click|load|error|submit|change|input)=/i.test(html), `${page}: has no inline event handler attributes`);
}

console.log(`\n${pass} checks passed`);
