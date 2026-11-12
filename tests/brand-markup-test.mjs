// The shared brand markup (src/lib/brand-markup.js): markSvg, BRAND_HTML, MARK_HTML, LEGAL_HTML.
import assert from 'node:assert/strict';
const B = await import(new URL('../src/lib/brand-markup.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const count = (s, re) => (s.match(re) || []).length;

const bare = B.markSvg();
ok(bare.startsWith('<svg class="spark-mark"'), 'the mark is an svg with the spark-mark class');
ok(bare.includes('aria-hidden="true"') && bare.includes('focusable="false"'), 'the mark is hidden from assistive tech');
ok(!bare.includes('<defs>'), 'gradient defs are left out by default');
ok(count(bare, /<rect /g) === 8 && count(bare, /<path /g) === 2, 'two layers of four bars and one bolt each');
ok(bare.includes('class="sm-base"') && bare.includes('class="sm-light"'), 'a base layer and a light layer');

const withCls = B.markSvg({ cls: 'brand-mark', defs: true });
ok(withCls.startsWith('<svg class="spark-mark brand-mark"'), 'an extra class is appended');
ok(withCls.includes('id="sparkBars"') && withCls.includes('id="sparkBolt"'), 'defs: true includes both gradients');

ok(B.MARK_HTML === bare, 'MARK_HTML is the plain mark');
ok(B.BRAND_HTML.includes('href="/"') && B.BRAND_HTML.includes('aria-label="SparkScribe home"'), 'the brand links home with a label');
ok(B.BRAND_HTML.includes('>Spark</span>') && B.BRAND_HTML.includes('>Scribe</span>'), 'the wordmark is Spark + Scribe');
ok(count(B.BRAND_HTML, /id="sparkBars"/g) === 1, 'the header brand carries the gradients exactly once');
ok(!B.MARK_HTML.includes('id="sparkBars"'), 'other copies of the mark reuse the header gradients');

ok(B.BRAND_FONT_LINK.startsWith('<link rel="stylesheet"') && B.BRAND_FONT_LINK.includes('Sora'), 'the font link loads the brand fonts');

for (const p of ['/pricing', '/help', '/privacy', '/terms', '/lecture-notes', '/flashcards', '/exam-prep']) {
  ok(B.LEGAL_HTML.includes(`href="${p}"`), `the footer links to ${p}`);
}
ok(B.LEGAL_HTML.startsWith('<footer') && B.LEGAL_HTML.endsWith('</footer>'), 'the footer is one footer element');

console.log(`${pass} checks passed`);
