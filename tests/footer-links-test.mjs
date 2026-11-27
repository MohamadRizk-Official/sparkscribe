// Links in the shared site chrome (src/lib/brand-markup.js: BRAND_HTML, LEGAL_HTML, and the nav in src/lib/account.js):
// every internal link on every page's footer and brand mark leads to a page the build serves.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const B = await import(new URL('../src/lib/brand-markup.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const root = fileURLToPath(new URL('../', import.meta.url));
const cfg = readFileSync(join(root, 'vite.config.js'), 'utf8');
const clean = [...cfg.match(/const cleanRoutes = new Set\(\[([^\]]*)\]/)[1].matchAll(/'(\/[\w/-]*)'/g)].map((m) => m[1]);
const served = new Set(['/', ...clean]);

const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
const internal = (list) => list.filter((h) => h.startsWith('/'));

const footer = hrefs(B.LEGAL_HTML);
ok(footer.length >= 8, `the footer has links (${footer.length})`);
ok(internal(footer).length === 7 && internal(footer).every((h) => served.has(h)), 'every internal footer link is a page the build serves');
ok(internal(footer).every((h) => existsSync(join(root, h === '/' ? 'index.html' : `${h.slice(1)}.html`))), '…and its HTML file exists');
ok(footer.filter((h) => h.startsWith('mailto:')).length === 1, 'there is exactly one contact address');
ok(['/privacy', '/terms'].every((h) => footer.includes(h)), 'the footer links to the Privacy Policy and the Terms');
ok(new Set(footer).size === footer.length, 'no link is listed twice');
ok(/aria-label="Footer"/.test(B.LEGAL_HTML) && /aria-label="For students"/.test(B.LEGAL_HTML), 'the two footer groups are labelled for screen readers');
ok(/Your audio is transcribed on your device and never uploaded/.test(B.LEGAL_HTML), 'the footer states the on-device promise the product keeps');

const brand = hrefs(B.BRAND_HTML);
ok(brand.length === 1 && brand[0] === '/', 'the brand mark links home');
ok(/aria-label="SparkScribe home"/.test(B.BRAND_HTML), 'the brand link is named for screen readers');

// the static pages that share one script
const pagesWithFooter = ['privacy', 'terms', 'help', 'lecture-notes', 'flashcards', 'exam-prep'];
for (const p of pagesWithFooter) ok(existsSync(join(root, `${p}.html`)) && /<script[^>]*src="\/src\/pages\/legal\.js"/.test(readFileSync(join(root, `${p}.html`), 'utf8')), `${p}.html loads the shared legal-page script (theme switch and account menu)`);

console.log(`\n${pass} checks passed`);
