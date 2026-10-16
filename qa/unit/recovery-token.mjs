// The API refuses password-reset sessions (server/http.js isRecoveryToken).   node qa/unit/recovery-token.mjs
import assert from 'node:assert/strict';
import { isRecoveryToken } from '../../server/http.js';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (amr) => `${b64({ alg: 'HS256' })}.${b64({ sub: 'u', amr })}.sig`;
const cases = [
  ['newest sign-in is a reset link', jwt([{ method: 'password', timestamp: 100 }, { method: 'recovery', timestamp: 200 }]), true],
  ['signed in with a password after a reset', jwt([{ method: 'recovery', timestamp: 100 }, { method: 'password', timestamp: 200 }]), false],
  ['Google', jwt([{ method: 'oauth', timestamp: 100 }]), false],
  ['no amr', jwt(undefined), false],
  ['not a JWT', 'garbage', false],
];
for (const [name, token, want] of cases) { assert.equal(isRecoveryToken(token), want, name); console.log(`ok - ${name}`); }
