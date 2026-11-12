// Appearance preference (src/lib/theme.js): getThemePref, resolvedTheme, applyTheme, THEME_BOOT.
import assert from 'node:assert/strict';

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
const root = { dataset: {} };
globalThis.document = { documentElement: root };
const events = [];
globalThis.window = { dispatchEvent: (e) => events.push(e), addEventListener() {} };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const T = await import(new URL('../src/lib/theme.js', import.meta.url).href);

ok(T.THEME_KEY === 'sparkscribe.theme', 'the storage key is sparkscribe.theme');
ok(T.THEME_MODES.join() === 'system,light,dark', 'three modes: system, light, dark');
ok(T.THEME_DEFAULT === 'light', 'new visitors start in light');

ok(T.getThemePref() === 'light', 'nothing stored gives the default');
store.set(T.THEME_KEY, 'dark');
ok(T.getThemePref() === 'dark', 'a stored mode is returned');
store.set(T.THEME_KEY, 'neon');
ok(T.getThemePref() === 'light', 'an unknown stored value falls back to the default');
const real = globalThis.localStorage;
globalThis.localStorage = { getItem() { throw new Error('blocked'); } };
ok(T.getThemePref() === 'light', 'blocked storage falls back to the default');
globalThis.localStorage = real;

ok(T.resolvedTheme('light') === 'light' && T.resolvedTheme('dark') === 'dark', 'light and dark resolve to themselves');
ok(T.resolvedTheme('system') === 'dark', 'system with no media query resolves to dark');

T.applyTheme('dark');
ok(root.dataset.theme === 'dark' && root.dataset.themePref === 'dark', 'applyTheme sets theme and theme-pref');
ok(events.length === 1 && events[0].type === 'sparkscribe:theme' && events[0].detail === 'dark', 'a change fires sparkscribe:theme with the new theme');
T.applyTheme('dark');
ok(events.length === 1, 'applying the same theme again fires nothing');
T.applyTheme('system');
ok(root.dataset.theme === 'dark' && root.dataset.themePref === 'system', 'the pref is recorded separately from the shown theme');
ok(events.length === 1, 'switching pref without changing the shown theme fires nothing');

ok(T.THEME_BOOT.startsWith('<script>') && T.THEME_BOOT.endsWith('</script>'), 'the boot snippet is an inline script');
ok(T.THEME_BOOT.includes(T.THEME_KEY), 'the boot snippet reads the same storage key');

console.log(`${pass} checks passed`);
