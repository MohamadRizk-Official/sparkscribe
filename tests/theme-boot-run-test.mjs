// The inline theme boot script (src/lib/theme.js: THEME_BOOT) actually run: the snippet is evaluated in an isolated
// context with a stand-in document, localStorage and matchMedia, the way a browser would run it before first paint.
import assert from 'node:assert/strict';
import vm from 'node:vm';
const { THEME_BOOT, THEME_KEY, THEME_DEFAULT } = await import(new URL('../src/lib/theme.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const body = THEME_BOOT.replace(/^<script>/, '').replace(/<\/script>$/, '');

// what the page ends up with for a stored choice and a device setting
const boot = ({ stored = undefined, lightDevice = false, storageThrows = false, noMatchMedia = false } = {}) => {
  const attrs = {};
  const sandbox = {
    document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } },
    localStorage: { getItem: (k) => { if (storageThrows) throw new Error('blocked'); return k === THEME_KEY && stored !== undefined ? stored : null; } },
    window: {},
  };
  if (!noMatchMedia) { sandbox.window.matchMedia = sandbox.matchMedia = (q) => ({ matches: lightDevice && /light/.test(q) }); }
  vm.runInNewContext(body, sandbox);
  return attrs;
};

ok(THEME_DEFAULT === 'dark', 'new visitors start in dark');
let a = boot();
ok(a['data-theme'] === 'dark' && a['data-theme-pref'] === 'dark', 'nothing stored: dark, and the choice is recorded as dark');
a = boot({ stored: 'light' });
ok(a['data-theme'] === 'light' && a['data-theme-pref'] === 'light', 'a stored "light" is applied');
a = boot({ stored: 'dark', lightDevice: true });
ok(a['data-theme'] === 'dark', 'a stored "dark" wins over a light device');
a = boot({ stored: 'system', lightDevice: true });
ok(a['data-theme'] === 'light' && a['data-theme-pref'] === 'system', '"system" follows a light device and keeps the choice as system');
a = boot({ stored: 'system', lightDevice: false });
ok(a['data-theme'] === 'dark' && a['data-theme-pref'] === 'system', '"system" follows a dark device');
a = boot({ stored: 'system', noMatchMedia: true });
ok(a['data-theme'] === 'dark', '"system" in a browser with no matchMedia falls back to dark');
a = boot({ storageThrows: true });
ok(a['data-theme'] === 'dark' && a['data-theme-pref'] === 'dark', 'blocked storage (private window) falls back to dark without an error');
a = boot({ stored: '' });
ok(a['data-theme-pref'] === 'dark', 'an empty stored value counts as no choice');
a = boot({ stored: 'sepia' });
ok(a['data-theme-pref'] === 'sepia' && a['data-theme'] === 'dark', 'an unknown stored value shows dark (the page code later corrects the choice)');
ok(!/=>|\blet\b|\bconst\b|`/.test(body), 'the snippet is plain ES5, so it runs in every browser before any module');
ok(THEME_BOOT.length < 600, 'the snippet is small enough to inline in every page');

console.log(`\n${pass} checks passed`);
