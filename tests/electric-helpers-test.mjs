// Pure parts of the "Electric" UI modules: the speed options (src/electric/speed-menu.js) and Thunder's mark and
// Pricing link (src/electric/thunder.js). Loaded through tests/vite-env-hook.mjs because thunder.js imports the dialogs.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./vite-env-hook.mjs', import.meta.url);
globalThis.location = new URL('https://www.spark-scribe.com/ask');
const { SPEED_OPTIONS } = await import(new URL('../src/electric/speed-menu.js', import.meta.url).href);
const { thunderMark, thunderPricingUrl } = await import(new URL('../src/electric/thunder.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

// ---- playback speeds
ok(SPEED_OPTIONS.join() === '0.75,1,1.25,1.5,1.75,2', 'the speeds are 0.75× to 2× in steps of a quarter');
ok(SPEED_OPTIONS.includes(1), 'normal speed is on the list');
ok(SPEED_OPTIONS.every((r, i) => i === 0 || r > SPEED_OPTIONS[i - 1]), 'the speeds are in ascending order');
ok(SPEED_OPTIONS.every((r) => r >= 0.5 && r <= 4), 'every speed is one a browser can play');

// ---- Thunder link to Pricing
ok(thunderPricingUrl() === '/pricing?highlight=thunder', 'without a return address the link only highlights Thunder');
ok(thunderPricingUrl('') === '/pricing?highlight=thunder', 'an empty return address is treated as none');
ok(thunderPricingUrl('/across') === '/pricing?highlight=thunder&next=%2Facross', 'the return address is URL-encoded');
const back = '/library?view=all&q=a b#x';
const u = new URL(thunderPricingUrl(back), 'https://www.spark-scribe.com');
ok(u.pathname === '/pricing' && u.searchParams.get('highlight') === 'thunder', 'the link points at /pricing');
ok(u.searchParams.get('next') === back, 'a return address with its own query and spaces survives the round trip');
ok(!/&view=|#x/.test(thunderPricingUrl(back).split('next=')[1]), 'the return address cannot add parameters of its own');

// ---- the mark
const mark = thunderMark();
ok(mark.includes('class="thunder-mark"') && mark.includes('<span>Thunder</span>'), 'the mark says Thunder by default');
ok(mark.includes('<svg') && mark.includes('aria-hidden="true"'), 'the bolt icon is hidden from screen readers');
ok(thunderMark('Ask').includes('<span>Ask</span>'), 'the label can be changed');
ok(mark.includes('tm-arc'), 'the mark carries the element the hover effect animates');

console.log(`\n${pass} checks passed`);
