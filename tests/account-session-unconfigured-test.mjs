// Sign-in state without accounts (src/lib/account.js: getSession, getUser, requireUser, changeEmail).
// Loaded through tests/vite-env-hook.mjs, so Supabase is "not configured": nobody can be signed in and nothing is sent.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./vite-env-hook.mjs', import.meta.url);
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
const moves = [];
globalThis.location = { pathname: '/library', search: '?view=favorites', hash: '', replace: (u) => moves.push(u), assign: (u) => moves.push(u) };
globalThis.fetch = async () => { throw new Error('nothing may be sent when accounts are off'); };
const A = await import(new URL('../src/lib/account.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

ok((await A.getSession()) === null, 'getSession: nobody is signed in');
ok((await A.getUser()) === null, 'getUser: nobody is signed in');
const r = await A.changeEmail('new@example.com');
ok(r.user === null && /aren.t available here/.test(r.error.message), 'changeEmail says accounts are not available, without calling anything');
await A.signOut();
ok(true, 'signOut does nothing and does not throw');

const outcome = await Promise.race([A.requireUser().then(() => 'returned'), new Promise((res) => setTimeout(() => res('pending'), 50))]);
ok(outcome === 'pending', 'requireUser never resolves for a signed-out visitor (the page stops while the browser navigates)');
ok(moves.length === 1 && moves[0] === `/auth?next=${encodeURIComponent('/library?view=favorites')}`, 'the visitor is sent to /auth with the page they wanted as next');

console.log(`\n${pass} checks passed`);
process.exit(0);
