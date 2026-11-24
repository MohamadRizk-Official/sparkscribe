// lib/recovery.js: how a password-reset session is recognised (recoveryAge / isFreshRecovery) and the one-time
// reset link kept in sessionStorage. Loaded through vite-env-hook.mjs because the module imports the Supabase client.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./vite-env-hook.mjs', import.meta.url);
const R = await import(new URL('../src/lib/recovery.js', import.meta.url).href);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const now = () => Date.now() / 1000;

ok(R.RECOVERY_WINDOW_S === 900, 'the recovery window is 15 minutes');
ok(R.recoveryAge({ access_token: 'garbage' }) === null, 'an unreadable token is not a recovery session');
ok(R.recoveryAge({}) === null && R.recoveryAge(null) === null, 'a missing session is not a recovery session');
ok(R.recoveryAge({ access_token: jwt({ amr: [] }) }) === null, 'no sign-in methods: not a recovery session');
ok(R.recoveryAge({ access_token: jwt({ amr: [{ method: 'password', timestamp: now() - 5 }] }) }) === null, 'a normal password sign-in is not a recovery session');
const age = R.recoveryAge({ access_token: jwt({ amr: [{ method: 'recovery', timestamp: now() - 60 }] }) });
ok(age >= 59 && age < 62, 'a recovery sign-in reports its age in seconds');
ok(R.recoveryAge({ access_token: jwt({ amr: [{ method: 'recovery', timestamp: now() - 600 }, { method: 'password', timestamp: now() - 10 }] }) }) === null, 'only the NEWEST sign-in decides: a later password sign-in ends the recovery state');
ok(R.recoveryAge({ access_token: jwt({ amr: [{ method: 'password', timestamp: now() - 600 }, { method: 'recovery', timestamp: now() - 10 }] }) }) !== null, 'a recovery sign-in newer than a password one counts');
ok(R.recoveryAge({ access_token: jwt({ amr: [{ method: 'recovery', timestamp: now() + 500 }] }) }) === 0, 'a timestamp in the future gives age 0, never negative');
ok(R.isFreshRecovery({ access_token: jwt({ amr: [{ method: 'recovery', timestamp: now() - 100 }] }) }) === true, 'a 100 s old recovery session is fresh');
ok(R.isFreshRecovery({ access_token: jwt({ amr: [{ method: 'recovery', timestamp: now() - 901 }] }) }) === false, 'a recovery session older than 900 s is not fresh');
ok(R.isFreshRecovery({ access_token: jwt({ amr: [{ method: 'password', timestamp: now() }] }) }) === false, 'a non-recovery session is never fresh');
ok(await R.guardRecovery(null, '/library') === false, 'guardRecovery ignores a missing session');
ok(await R.guardRecovery({ access_token: jwt({ amr: [{ method: 'password', timestamp: now() }] }) }, '/library') === false, 'guardRecovery ignores a normal session');
ok(await R.guardRecovery({ access_token: jwt({ amr: [{ method: 'recovery', timestamp: now() }] }) }, '/auth') === false, 'guardRecovery leaves the /auth page alone');
console.log(`${pass} checks passed`);
