// Library helpers (src/lib/library.js): search-snippet highlighting (must stay HTML-safe) and the hours text.
// Loaded through tests/vite-env-hook.mjs. The data calls need Supabase and are not exercised here.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./vite-env-hook.mjs', import.meta.url);
const L = await import(new URL('../src/lib/library.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

ok(L.PAGE_SIZE === 24 && L.SEARCH_PAGE_SIZE === 10, 'page sizes: 24 recordings, 10 search results');

// ---- highlight: the database marks matches with \u0002 … \u0003; everything else must be escaped
ok(L.highlight('the \u0002cat\u0003 sat') === 'the <mark>cat</mark> sat', 'match markers become <mark> tags');
ok(L.highlight('\u0002a\u0003 and \u0002b\u0003') === '<mark>a</mark> and <mark>b</mark>', 'every match is marked');
ok(L.highlight('<script>alert(1)</script>') === '&lt;script&gt;alert(1)&lt;/script&gt;', 'HTML in a transcript is escaped, not rendered');
ok(L.highlight('a \u0002<b>\u0003 c') === 'a <mark>&lt;b&gt;</mark> c', 'a match that looks like a tag is escaped inside the mark');
ok(L.highlight('Tom & "Jerry\'s"') === 'Tom &amp; &quot;Jerry&#39;s&quot;', 'ampersands and quotes are escaped');
ok(L.highlight('') === '' && L.highlight(null) === '' && L.highlight(undefined) === '', 'no snippet gives empty text');
ok(L.highlight(42) === '42', 'a number is turned into text');
ok(L.highlight('plain') === 'plain', 'text without matches is unchanged');
ok(!/<(?!\/?mark>)/.test(L.highlight('x <img src=x onerror=1> \u0002y\u0003')), 'the only tags that can come out are mark and /mark');

// ---- fmtHours
ok(L.fmtHours(0) === '0 min' && L.fmtHours(null) === '0 min' && L.fmtHours(undefined) === '0 min', 'nothing used is "0 min"');
ok(L.fmtHours(29) === '0 min', 'under 30 seconds rounds down to 0 min');
ok(L.fmtHours(90) === '2 min', 'minutes are rounded to the nearest');
ok(L.fmtHours(3599) === '60 min', 'just under an hour is still shown in minutes');
ok(L.fmtHours(3600) === '1.0 hours', 'one hour shows one decimal (and the plural form)');
ok(L.fmtHours(5400) === '1.5 hours', 'an hour and a half');
ok(L.fmtHours(9.9 * 3600) === '9.9 hours', 'under ten hours keeps one decimal');
ok(L.fmtHours(10 * 3600) === '10 hours', 'from ten hours, whole hours');
ok(L.fmtHours(20 * 3600 + 1800) === '21 hours', 'whole hours are rounded');
console.log(`${pass} checks passed`);
