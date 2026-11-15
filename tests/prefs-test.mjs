// Display preferences (src/lib/prefs.js): mascot mode and appearance, kept in localStorage, announced to the page, and adopted from the account.
// Loaded through tests/vite-env-hook.mjs, so Supabase is "not configured" and nothing is synced; window, document and localStorage are stand-ins.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./vite-env-hook.mjs', import.meta.url);
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = new EventTarget();
globalThis.document = { documentElement: { dataset: {} } };
const P = await import(new URL('../src/lib/prefs.js', import.meta.url).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('ok -', msg); };
const heard = [];
window.addEventListener('sparkscribe:mascot-pref', (e) => heard.push(['mascot', e.detail]));
window.addEventListener('sparkscribe:theme', (e) => heard.push(['theme', e.detail]));

ok(P.MASCOT_KEY === 'sparkscribe.mascot' && P.MASCOT_MODES.join() === 'on,quiet,off', 'mascot key and modes');

// ---- mascot
ok(P.getMascotPref() === 'on', 'the mascot defaults to on');
await P.setMascotPref('quiet');
ok(P.getMascotPref() === 'quiet' && store.get('sparkscribe.mascot') === 'quiet', 'a choice is stored in this browser');
ok(heard.some((h) => h[0] === 'mascot' && h[1] === 'quiet'), 'the page is told with a sparkscribe:mascot-pref event');
heard.length = 0;
await P.setMascotPref('loud');
ok(P.getMascotPref() === 'quiet' && heard.length === 0, 'an unknown mode is ignored: nothing stored, no event');
store.set('sparkscribe.mascot', 'garbage');
ok(P.getMascotPref() === 'on', 'a corrupted stored value reads as the default');
await P.setMascotPref('off', { sync: false });
ok(P.getMascotPref() === 'off', 'sync: false still saves locally');

// ---- appearance
ok(P.getThemePref() === 'dark', 'appearance defaults to dark');
await P.setThemePref('dark');
ok(P.getThemePref() === 'dark' && store.get('sparkscribe.theme') === 'dark', 'dark is stored');
ok(document.documentElement.dataset.theme === 'dark' && document.documentElement.dataset.themePref === 'dark', 'it is applied to the page straight away');
ok(heard.some((h) => h[0] === 'theme' && h[1] === 'dark'), 'a theme change is announced');
await P.setThemePref('nonsense');
ok(P.getThemePref() === 'dark', 'an unknown appearance is ignored');
await P.setThemePref('system');
ok(document.documentElement.dataset.themePref === 'system' && document.documentElement.dataset.theme === 'dark', 'System with no media-query support resolves to dark');

// ---- adoptAccountPrefs: the account's choice wins on a browser that differs
await P.setMascotPref('on', { sync: false }); await P.setThemePref('light', { sync: false });
P.adoptAccountPrefs({ user_metadata: { sparkscribe_mascot: 'off', sparkscribe_theme: 'dark' } });
ok(P.getMascotPref() === 'off' && P.getThemePref() === 'dark', 'the account\'s mascot and appearance replace this browser\'s');
P.adoptAccountPrefs({ user_metadata: { sparkscribe_mascot: 'bogus', sparkscribe_theme: 'bogus' } });
ok(P.getMascotPref() === 'off' && P.getThemePref() === 'dark', 'invalid account values are ignored');
P.adoptAccountPrefs(null); P.adoptAccountPrefs({}); P.adoptAccountPrefs({ user_metadata: {} });
ok(P.getMascotPref() === 'off', 'no user or no metadata changes nothing');
heard.length = 0;
P.adoptAccountPrefs({ user_metadata: { sparkscribe_mascot: 'off' } });
ok(heard.length === 0, 'adopting an identical value does nothing');

// ---- blocked storage
globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
ok(P.getMascotPref() === 'on' && P.getThemePref() === 'dark', 'blocked storage reads as the defaults');
heard.length = 0;
await P.setMascotPref('quiet');
ok(heard.some((h) => h[0] === 'mascot' && h[1] === 'quiet'), 'the choice still reaches this page when it cannot be stored');
console.log(`${pass} checks passed`);
