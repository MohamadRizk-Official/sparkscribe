// Real-Postgres concurrency test of the PROPOSED AI usage limits. PGlite (ai-limits.test.mjs) has one connection, so
// "parallel" calls there run one after another; this starts a throwaway local PostgreSQL server (embedded-postgres,
// data in a temp folder, deleted afterwards), applies every production migration + the proposal, and fires
// reservations from many connections at once, each in its own transaction the way PostgREST runs an RPC
// (SET LOCAL ROLE authenticated + request.jwt.claims). No network, no production data.
//   node qa/sql/concurrency.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { BOOT, migrationFiles } from './pg.mjs';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };

const dir = mkdtempSync(join(tmpdir(), 'sparkscribe-qa-pg-'));
const PORT = 54329;
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'qa-local-only', port: PORT, persistent: false, onLog: () => {} });
await server.initialise();
await server.start();
const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'qa-local-only', database: 'postgres', max: 60 });

try {
  const admin = await pool.connect();
  await admin.query(BOOT);
  for (const m of migrationFiles({ proposed: true })) await admin.query(m.sql());
  await admin.query(`insert into private.billing_secrets (name, hash) values ('server', sha256(convert_to('qa-secret', 'UTF8')))`);
  await admin.query(`update public.billing_settings set metering_starts_at = now() - interval '1 day', enforce_ai_limits = true`);
  const v = (await admin.query('show server_version')).rows[0].server_version;
  ok(true, `PostgreSQL ${v}: all production migrations + proposal applied`);

  // a variant of ai_reserve to show what the advisory lock prevents: same body, optionally without the lock,
  // with a short pause between the count and the insert (widens the race window so the test is not luck-based)
  const { rows: [{ src }] } = await admin.query(`select pg_get_functiondef('public.ai_reserve(text,integer,text)'::regprocedure) src`);
  const variant = (name, keepLock) => src
    .replace('public.ai_reserve(', `public.${name}(`)
    .replace(/perform pg_advisory_xact_lock\([^;]*;/, keepLock ? '$&' : '-- (lock removed for the negative control)')
    .replace(/(if enforced and lim\.plan is not null then)/, 'perform pg_sleep(0.02);\n  $1');
  await admin.query(variant('qa_reserve_slow_locked', true));
  await admin.query(variant('qa_reserve_slow_unlocked', false));
  await admin.query('grant execute on function public.qa_reserve_slow_locked(text, integer, text), public.qa_reserve_slow_unlocked(text, integer, text) to authenticated');
  const newUser = async (email) => (await admin.query('insert into auth.users (email) values ($1) returning id', [email])).rows[0].id;
  const rowsOf = async (uid) => (await admin.query('select count(*)::int n from public.ai_usage where user_id = $1', [uid])).rows[0].n;
  admin.release();

  // one RPC = one connection + one transaction, like PostgREST
  const rpc = async (uid, fn, est = 0) => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role authenticated');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
      const r = (await c.query(`select public.${fn}('ask', $1, 'qa-secret') r`, [est])).rows[0].r; // the server passes its secret
      await c.query('commit');
      return r;
    } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  };
  const burst = (uid, fn, n, est) => Promise.all(Array.from({ length: n }, () => rpc(uid, fn, est)));

  const u1 = await newUser('burst@example.com');
  const r1 = await burst(u1, 'ai_reserve', 50);
  ok(r1.filter((r) => r.allowed).length === 20 && (await rowsOf(u1)) === 20, '50 simultaneous connections, Free (20/hour): exactly 20 allowed, 20 rows');

  const u2 = await newUser('slow-locked@example.com');
  const r2 = await burst(u2, 'qa_reserve_slow_locked', 50);
  ok(r2.filter((r) => r.allowed).length === 20 && (await rowsOf(u2)) === 20, 'with a 20 ms pause inside the check, the lock still holds it to exactly 20');

  const u3 = await newUser('slow-unlocked@example.com');
  const r3 = await burst(u3, 'qa_reserve_slow_unlocked', 50);
  const over = r3.filter((r) => r.allowed).length;
  ok(over > 20, `negative control: the same function WITHOUT the lock lets ${over} of 50 through (the test can detect a race)`);

  const u4 = await newUser('budget@example.com');
  const r4 = await burst(u4, 'ai_reserve', 12, 20000);
  ok(r4.filter((r) => r.allowed).length === 7 && r4.filter((r) => r.reason === 'monthly').length === 5, '12 simultaneous $0.02 estimates on the $0.15 Free budget: exactly 7 allowed, 5 refused as monthly');

  const [a, b] = [await newUser('a@example.com'), await newUser('b@example.com')];
  const [ra, rb] = await Promise.all([burst(a, 'qa_reserve_slow_locked', 30), burst(b, 'qa_reserve_slow_locked', 30)]);
  ok(ra.filter((r) => r.allowed).length === 20 && rb.filter((r) => r.allowed).length === 20, 'two users bursting 30 each at once: each gets exactly their own 20 (limits are per user)');

  // the lock is per user: while one of user C's requests is mid-transaction, C's next request waits but D's doesn't
  const [c, d] = [await newUser('c@example.com'), await newUser('d@example.com')];
  const holder = await pool.connect();
  await holder.query('begin');
  await holder.query('set local role authenticated');
  await holder.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: c, role: 'authenticated' })]);
  await holder.query(`select public.ai_reserve('ask', 0)`);           // holds C's lock until commit
  const timed = async (uid) => {
    const q = await pool.connect();
    try {
      await q.query('begin'); await q.query(`set local lock_timeout = '1500ms'`); await q.query('set local role authenticated');
      await q.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
      await q.query(`select public.ai_reserve('ask', 0)`); await q.query('commit'); return 'ran';
    } catch (e) { await q.query('rollback'); return /lock timeout/.test(e.message) ? 'waited' : e.message; } finally { q.release(); }
  };
  const [cRes, dRes] = await Promise.all([timed(c), timed(d)]);
  await holder.query('commit'); holder.release();
  ok(cRes === 'waited' && dRes === 'ran', `per-user lock: a second request from the same user waits (${cRes}); another user's runs immediately (${dRes})`);
  ok((await rowsOf(c)) === 1 && (await rowsOf(d)) === 1, 'the request that gave up waiting left no row behind');
} finally {
  await pool.end().catch(() => {});
  await server.stop().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${pass} checks passed`);
