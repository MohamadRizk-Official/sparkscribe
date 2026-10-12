// Client-side security checks (any page on the QA harness): redirect targets, escaping helpers.
import { runTests, eq, assert } from './lib.js';

export async function run() {
  const { safeNext, esc } = await import('/src/lib/account.js?' + Date.now());
  return runTests([
    ['D4: safeNext keeps same-site paths', async () => {
      for (const ok of ['/', '/library', '/transcript?id=abc&t=12', '/?save=pending', '/library#folders']) eq(safeNext(ok, 'FALLBACK'), ok, ok);
    }],
    ['D4: safeNext refuses anything that leaves the site', async () => {
      const bad = ['//evil.com', '/\t/evil.com', '/\n/evil.com', '/\r\n/evil.com', '/\t\t/evil.com', '\\evil.com', '/\\evil.com', 'https://evil.com',
        'javascript:alert(1)', ' /library', '/\u0000x', '', null, undefined, 42];
      for (const b of bad) {
        const v = safeNext(b, '/');
        eq(new URL(v, location.origin).host, location.host, `input ${JSON.stringify(b)} stays on site`);
        assert(v === '/' || v === b, `input ${JSON.stringify(b)} is either refused or unchanged`);
      }
    }],
    ['D4: the decoded query string from a crafted link is refused', async () => {
      const p = new URLSearchParams('next=%2F%09%2Fevil.com&x=1');
      eq(safeNext(p.get('next'), '/'), '/', 'tab-smuggled next');
    }],
    ['esc() escapes every HTML-significant character', async () => {
      eq(esc(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;', 'escaped');
      eq(esc(null), '', 'null → empty');
    }],
  ]);
}
