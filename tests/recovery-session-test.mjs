// Password-reset sessions (src/lib/recovery.js): how old a reset session is, whether it is still fresh, and the
// one-tab, single-use hand-off of a reset link. Loaded through tests/vite-env-hook.mjs; storage is a stand-in.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./vite-env-hook.mjs', import.meta.url);
const store = new Map();
globalThis.sessionStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const R = await import(new URL('../src/lib/recovery.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

const now = () => Date.now() / 1000;
const session = (amr) => ({ access_token: `h.${Buffer.from(JSON.stringify({ amr })).toString('base64url')}.s` });

// ---- recoveryAge
ok(R.RECOVERY_WINDOW_S === 900, 'a reset session may set a password for 15 minutes');
let age = R.recoveryAge(session([{ method: 'recovery', timestamp: now() - 60 }]));
ok(age >= 59 && age < 62, 'the age is the seconds since the reset link was opened');
ok(R.recoveryAge(session([{ method: 'password', timestamp: now() - 60 }])) === null, 'a normal sign-in has no recovery age');
ok(R.recoveryAge(session([{ method: 'recovery', timestamp: now() - 600 }, { method: 'password', timestamp: now() - 10 }])) === null, 'signing in with the new password after the link makes it a normal session');
age = R.recoveryAge(session([{ method: 'password', timestamp: now() - 600 }, { method: 'recovery', timestamp: now() - 30 }]));
ok(age !== null && age < 35, 'recovery as the newest method counts, wherever it sits in the list');
ok(R.recoveryAge(session([{ method: 'recovery', timestamp: now() + 3600 }])) === 0, 'a timestamp in the future (clock drift) is an age of 0, never negative');
ok(R.recoveryAge(session([])) === null, 'no methods: not a recovery session');
ok(R.recoveryAge(session('recovery')) === null, 'methods that are not a list: not a recovery session');
ok(R.recoveryAge({ access_token: 'garbage' }) === null, 'an unreadable token: not a recovery session');
ok(R.recoveryAge(null) === null && R.recoveryAge({}) === null, 'no session: not a recovery session');
const urlSafe = `h.${Buffer.from(JSON.stringify({ amr: [{ method: 'recovery', timestamp: now() - 5 }], note: '??>>' })).toString('base64url')}.s`;
ok(R.recoveryAge({ access_token: urlSafe }) !== null, 'a token in URL-safe base64 is read');

// ---- isFreshRecovery
ok(R.isFreshRecovery(session([{ method: 'recovery', timestamp: now() - 60 }])), 'a reset session a minute old is fresh');
ok(R.isFreshRecovery(session([{ method: 'recovery', timestamp: now() - 899 }])), '…and just under 15 minutes is still fresh');
ok(!R.isFreshRecovery(session([{ method: 'recovery', timestamp: now() - 901 }])), '…over 15 minutes is not');
ok(!R.isFreshRecovery(session([{ method: 'password', timestamp: now() }])), 'a normal sign-in is never a fresh recovery');
ok(!R.isFreshRecovery(null), 'no session is not a fresh recovery');

// ---- reset links kept in this tab only
ok(R.peekResetLink() === null, 'nothing is kept at first');
ok(R.keepResetLink('#token_hash=abcdef123456&type=recovery') === true, 'a link is kept');
let link = R.peekResetLink();
ok(link && link.hash === '#token_hash=abcdef123456&type=recovery', 'peek returns it');
ok(R.peekResetLink() !== null, 'peeking does not use it up');
link = R.takeResetLink();
ok(link && link.hash.includes('abcdef123456'), 'take returns it…');
ok(R.peekResetLink() === null && R.takeResetLink() === null, '…and it is single use');
R.keepResetLink('#token_hash=abcdef123456');
R.dropResetLink();
ok(R.peekResetLink() === null, 'drop removes it');
R.keepResetLink('short');
ok(R.peekResetLink() === null, 'a value under 10 characters is not a link');
ok(!store.has('sparkscribe.resetLink'), '…and is removed from storage when it is read');
store.set('sparkscribe.resetLink', JSON.stringify({ hash: '#token_hash=old-link-123', at: Date.now() - 61 * 60 * 1000 }));
ok(R.peekResetLink() === null, 'a link older than an hour has expired');
ok(!store.has('sparkscribe.resetLink'), '…and is removed');
store.set('sparkscribe.resetLink', 'not json');
ok(R.peekResetLink() === null, 'damaged storage reads as no link');
store.set('sparkscribe.resetLink', JSON.stringify({ hash: 12345678901234, at: Date.now() }));
ok(R.peekResetLink() === null, 'a link that is not text is ignored');

// storage that throws (blocked cookies)
const real = globalThis.sessionStorage;
globalThis.sessionStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
ok(R.keepResetLink('#token_hash=abcdef123456') === false, 'blocked storage: keeping a link reports false');
ok(R.peekResetLink() === null && R.takeResetLink() === null, 'blocked storage: reading finds none, without an error');
R.dropResetLink();
ok(true, 'blocked storage: dropping does not throw');
globalThis.sessionStorage = real;

console.log(`${pass} checks passed`);
