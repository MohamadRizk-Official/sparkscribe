// Account helpers (src/lib/account.js): HTML escaping, the open-redirect guard safeNext, the consent check and URL.
// Loaded through tests/vite-env-hook.mjs; `location` is a stand-in for the site's own origin.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./vite-env-hook.mjs', import.meta.url);
globalThis.location = new URL('https://www.spark-scribe.com/library?view=all');
const A = await import(new URL('../src/lib/account.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

// ---- esc
ok(A.esc('<b class="x">Tom & Jerry\'s</b>') === '&lt;b class=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/b&gt;', 'the five HTML-significant characters are escaped');
ok(A.esc(null) === '' && A.esc(undefined) === '', 'null and undefined become empty text');
ok(A.esc(0) === '0' && A.esc(false) === 'false', 'other values are turned into text');
ok(A.esc('&amp;') === '&amp;amp;', 'already-escaped text is escaped again (no double-decoding)');

// ---- safeNext: only a path on this site is ever used
const same = (v) => A.safeNext(v) === v;
ok(same('/library'), 'a plain path is kept');
ok(same('/transcript?id=abc&tab=ask#top'), 'query and hash are kept');
ok(A.safeNext('/') === '/', 'the root is fine');
ok(A.safeNext('https://evil.example/') === '/', 'an absolute URL falls back');
ok(A.safeNext('//evil.example/path') === '/', 'a protocol-relative URL falls back');
ok(A.safeNext('/\\evil.example') === '/' && A.safeNext('\\\\evil.example') === '/', 'backslashes fall back');
ok(A.safeNext('/\t/evil.example') === '/' && A.safeNext('/\n/evil.example') === '/', 'a tab or new line (dropped by browsers, giving "//") falls back');
ok(A.safeNext('/a\u0000b') === '/' && A.safeNext('/a\u007fb') === '/', 'control characters fall back');
ok(A.safeNext('javascript:alert(1)') === '/', 'a javascript: URL falls back');
ok(A.safeNext('library') === '/', 'a relative path without a leading slash falls back');
ok(A.safeNext('') === '/' && A.safeNext(null) === '/' && A.safeNext(undefined) === '/' && A.safeNext(42) === '/' && A.safeNext({}) === '/', 'non-strings and empty values fall back');
ok(A.safeNext('//evil.example', '/home') === '/home', 'the fallback can be chosen');
ok(A.safeNext('/ok', '/home') === '/ok', 'a good path ignores the fallback');

// (a path such as "/.//evil.example" is a known gap: see docs/FOUND-ISSUES.md #3, so it is not asserted here)

// ---- currentPath
ok(A.currentPath() === '/library?view=all', 'currentPath is the path and query of this page');

// ---- hasConsent: both timestamps are needed
const both = { user_metadata: { terms_accepted_at: '2026-10-17T00:00:00Z', age_13_plus_confirmed_at: '2026-10-17T00:00:00Z' } };
ok(A.hasConsent(both) === true, 'terms and age confirmation: consent given');
ok(A.hasConsent({ user_metadata: { terms_accepted_at: 'x' } }) === false, 'terms alone are not enough');
ok(A.hasConsent({ user_metadata: { age_13_plus_confirmed_at: 'x' } }) === false, 'the age confirmation alone is not enough');
ok(A.hasConsent({ user_metadata: {} }) === false && A.hasConsent({}) === false && A.hasConsent(null) === false && A.hasConsent(undefined) === false, 'no metadata or no user: no consent');

// ---- consentUrl
ok(A.consentUrl('/library') === '/auth?mode=consent&next=%2Flibrary', 'the consent URL carries the page to return to, encoded');
ok(A.consentUrl('/a?b=1&c=2') === '/auth?mode=consent&next=%2Fa%3Fb%3D1%26c%3D2', 'a query inside next is encoded so it stays one parameter');
ok(A.consentUrl() === '/auth?mode=consent&next=%2Flibrary%3Fview%3Dall', 'with no argument it uses the current page');
console.log(`${pass} checks passed`);
