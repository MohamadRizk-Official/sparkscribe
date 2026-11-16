// The browser's Supabase module when the site has no Supabase settings (src/lib/supabase.js): account features hide and
// nothing makes a network request. Loaded through tests/vite-env-hook.mjs, which leaves `import.meta.env` empty.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./vite-env-hook.mjs', import.meta.url);
let fetched = 0;
globalThis.fetch = () => { fetched++; return Promise.reject(new Error('no network in this test')); };
const S = await import(new URL('../src/lib/supabase.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

ok(S.isConfigured === false, 'without a URL and key the site is not configured');
ok(S.supabase === null, '…so there is no client');
ok(S.supabaseUrl === '', '…and the URL is an empty string, not "undefined"');
ok(S.isolatedClient() === null, 'no isolated client either');
ok((await S.authSettings()) === null, 'the sign-in methods are unknown (null), not an error');
ok(S.revokeSessionNow('some-token') === undefined, 'revoking a session is a quiet no-op');
ok(fetched === 0, 'none of this made a network request');

console.log(`${pass} checks passed`);
