// meterHtml (src/pages/account.js): the usage meter markup on /account.
// Loaded through tests/vite-env-hook.mjs; document and localStorage are stand-ins so the page module can be imported.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./vite-env-hook.mjs', import.meta.url);
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = new EventTarget();
globalThis.location = { pathname: '/account', search: '', hash: '', replace() {} }; // the page starts its own flow on import; it ends at the sign-in redirect
globalThis.document = { documentElement: { dataset: {} }, getElementById: () => null, addEventListener() {} };
const { meterHtml } = await import(new URL('../src/pages/account.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

const half = meterHtml({ usedSeconds: 1800, monthlySeconds: 3600, remainingSeconds: 1800 });
ok(half.includes('role="meter"') && half.includes('aria-valuemin="0"'), 'it is an accessible meter');
ok(half.includes('aria-valuemax="3600"') && half.includes('aria-valuenow="1800"'), 'the meter carries the allowance and the seconds used');
ok(half.includes('width:50.0%'), 'half used fills half the bar');
ok(half.includes('aria-label="Transcription used this period"'), 'the meter is labelled');
ok(/left<\/span>/.test(half), 'the remaining time is shown as "… left"');

const over = meterHtml({ usedSeconds: 9000, monthlySeconds: 3600, remainingSeconds: 0 });
ok(over.includes('width:100.0%'), 'the bar never fills past 100%');
ok(over.includes('aria-valuenow="9000"'), '…but the real number used is still reported');

const fresh = meterHtml({ usedSeconds: 0, monthlySeconds: 3600, remainingSeconds: 3600 });
ok(fresh.includes('width:0.0%'), 'nothing used shows an empty bar');
ok(fresh.includes('class="meter '), 'the wrapper has a meter class');

const strs = meterHtml({ usedSeconds: '600.4', monthlySeconds: 3600, remainingSeconds: '3000' });
ok(strs.includes('aria-valuenow="600"'), 'numeric strings from the server are accepted and rounded');

console.log(`\n${pass} checks passed`);
process.exit(0); // the page left a pending sign-in flow behind
