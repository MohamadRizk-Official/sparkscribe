// lib/account.js safeNext (open-redirect guard) and esc, on hostile inputs. `location` is a stand-in for the site origin.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./vite-env-hook.mjs', import.meta.url);
globalThis.location = new URL('https://www.spark-scribe.com/library?view=all');
const A = await import(new URL('../src/lib/account.js', import.meta.url).href);

let pass = 0;
const eq = (a, b, m) => { assert.equal(a, b, m); pass++; console.log('ok -', m); };

eq(A.safeNext('/library?view=all#top'), '/library?view=all#top', 'a path with query and hash is kept');
eq(A.safeNext('/'), '/', 'the root is allowed');
eq(A.safeNext('//evil.com'), '/', 'a protocol-relative URL falls back');
eq(A.safeNext('https://evil.com/x'), '/', 'an absolute URL falls back');
eq(A.safeNext('/\\evil.com'), '/', 'a backslash falls back');
eq(A.safeNext('/\t/evil.com'), '/', 'a tab (dropped by URL parsers) falls back');
eq(A.safeNext('/a\nb'), '/', 'a newline falls back');
eq(A.safeNext('/a\u007fb'), '/', 'DEL falls back');
eq(A.safeNext('javascript:alert(1)'), '/', 'a javascript: URL falls back');
eq(A.safeNext('library'), '/', 'a relative path without a slash falls back');
eq(A.safeNext(undefined), '/', 'undefined falls back');
eq(A.safeNext(42), '/', 'a non-string falls back');
eq(A.safeNext('//evil.com', '/home'), '/home', 'the fallback can be chosen');
eq(A.safeNext('/auth?next=%2Flibrary'), '/auth?next=%2Flibrary', 'an encoded query is left encoded');
eq(A.esc('<a href="x" onclick=\'y\'>&</a>'), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;', 'esc escapes the five HTML characters');
eq(A.esc(null), '', 'esc turns null into an empty string');
eq(A.esc(0), '0', 'esc keeps a zero');
eq(A.consentUrl('/library?a=1&b=2'), '/auth?mode=consent&next=%2Flibrary%3Fa%3D1%26b%3D2', 'the consent URL encodes the return path');
eq(A.hasConsent({ user_metadata: { terms_accepted_at: 'x' } }), false, 'consent needs both the terms and the age confirmation');
eq(A.hasConsent({ user_metadata: { terms_accepted_at: 'x', age_13_plus_confirmed_at: 'y' } }), true, 'both timestamps give consent');
eq(A.hasConsent(null), false, 'no user has no consent');
console.log(`${pass} checks passed`);
