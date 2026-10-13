// SQL-level tests of the PROPOSED self-service account deletion (supabase/proposed/*_account_deletion.sql) on an
// isolated Postgres with every production migration applied. No network, no production data.
//   node qa/sql/account-deletion.test.mjs
import assert from 'node:assert/strict';
import { freshDb } from './pg.mjs';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('ok -', m); };
const rejects = async (p, re, m) => { let err = null; try { await p; } catch (e) { err = e; } ok(err && re.test(err.message), `${m} (${err ? err.message.slice(0, 70) : 'no error'})`); };

const P = await freshDb({ proposed: true });
ok(P.applied.some((n) => n.includes('account_deletion')), 'proposed migration applies on top of all production migrations');
const { db } = P;
await db.query(`update public.billing_settings set metering_starts_at = now() - interval '1 day'`);

const now = () => Math.floor(Date.now() / 1000);
const fresh = () => ({ amr: [{ method: 'password', timestamp: now() - 30 }] });
const stale = () => ({ amr: [{ method: 'password', timestamp: now() - 20 * 60 }] });
const del = (uid, claims, confirm = 'DELETE') => P.asUser(uid, async (d) => (await d.query('select public.delete_my_account($1) r', [confirm])).rows[0].r, claims);

// every table that holds a user's data, counted per user
const USER_TABLES = ['transcriptions', 'transcription_insights', 'transcription_artifacts', 'transcription_questions', 'folders', 'folder_items', 'usage', 'subscriptions', 'ai_usage'];
async function footprint(uid) {
  const out = {};
  for (const t of USER_TABLES) out[t] = (await db.query(`select count(*)::int n from public.${t} where user_id = $1`, [uid])).rows[0].n;
  out.profiles = (await db.query('select count(*)::int n from public.profiles where id = $1', [uid])).rows[0].n;
  out.auth_user = (await db.query('select count(*)::int n from auth.users where id = $1', [uid])).rows[0].n;
  out.sessions = (await db.query('select count(*)::int n from auth.sessions where user_id = $1', [uid])).rows[0].n;
  out.identities = (await db.query('select count(*)::int n from auth.identities where user_id = $1', [uid])).rows[0].n;
  out.billing_events = (await db.query('select count(*)::int n from public.billing_events where user_id = $1', [uid])).rows[0].n;
  return out;
}
// a user with something in every table, created the way the app creates it (as the user, through RLS)
async function populate(email) {
  const uid = await P.createUser(email);
  await P.asUser(uid, async (d) => {
    const t = (await d.query(`insert into public.transcriptions (title, transcript_text, duration_seconds, segments) values ('Meeting', 'hello', 60, '[{"s":0,"e":5,"sp":"Speaker 1","t":"hello"}]') returning id`)).rows[0].id;
    await d.query(`insert into public.folders (name) values ('Work')`);
    const f = (await d.query('select id from public.folders limit 1')).rows[0].id;
    await d.query('insert into public.folder_items (folder_id, transcription_id) values ($1, $2)', [f, t]);
    await d.query(`insert into public.transcription_insights (transcription_id, kind, source_version, status) values ($1, 'overview', 1, 'ready')`, [t]);
    await d.query(`insert into public.transcription_artifacts (transcription_id, kind, source_version, status) values ($1, 'quiz', 1, 'ready')`, [t]);
    await d.query(`insert into public.transcription_questions (transcription_id, question, source_version) values ($1, 'What?', 1)`, [t]);
    await d.query(`select public.ai_reserve('ask', 100)`);
  });
  await db.query(`insert into public.subscriptions (user_id, plan, status) values ($1, 'free', 'inactive')`, [uid]); // as the billing webhook would
  await db.query(`insert into public.billing_events (id, type, livemode, user_id, stripe_customer_id, result) values ($1, 'checkout.session.completed', false, $2, $3, 'processed')`, [`evt_${email}`, uid, `cus_${email.split('@')[0]}`]);
  return uid;
}

const a = await populate('a@example.com');
const b = await populate('b@example.com');
const before = await footprint(a);
ok(Object.entries(before).every(([, n]) => n >= 1), `test user has rows everywhere: ${JSON.stringify(before)}`);
const bBefore = await footprint(b);

// ---- guards ----
await rejects(P.asAnon((d) => d.query(`select public.delete_my_account('DELETE')`)), /permission denied/, 'anonymous visitors cannot call it');
await rejects(del(a, fresh(), 'delete'), /type DELETE/, 'the exact confirmation word is required');
await rejects(del(a, fresh(), null), /type DELETE/, 'a missing confirmation is refused');
ok((await del(a, {})).reason === 'reauth', 'a token without sign-in method timestamps (amr) is refused: re-enter password');
ok((await del(a, stale())).reason === 'reauth', 'a sign-in 20 minutes ago is too old: re-enter password');
ok((await del(a, { amr: [{ method: 'password', timestamp: 'soon' }] })).reason === 'reauth', 'a malformed amr timestamp is refused, not an error');
ok((await del(a, { amr: 'x' })).reason === 'reauth', 'a non-array amr is refused, not an error');
ok((await del(a, { amr: [{ method: 'token_refresh', timestamp: now() - 5 }, { method: 'password', timestamp: now() - 3 * 3600 }] })).reason === 'reauth', 'a recent token refresh does not count as signing in (old password sign-in → re-enter password)');
ok((await del(a, { amr: [{ method: 'signup', timestamp: now() - 5 }] })).reason === 'reauth', 'neither does a sign-up or other non-sign-in event');
ok(JSON.stringify(await footprint(a)) === JSON.stringify(before), 'refused attempts changed nothing');

// ---- a paid subscription that would keep charging blocks deletion; a canceled-at-period-end one doesn't ----
await db.query(`update public.subscriptions set plan = 'plus', status = 'active', stripe_customer_id = 'cus_a', cancel_at_period_end = false where user_id = $1`, [a]);
ok((await del(a, fresh())).reason === 'subscription', 'an active Plus subscription blocks deletion (cancel first)');
await db.query(`update public.subscriptions set cancel_at_period_end = true where user_id = $1`, [a]);

// ---- delete ----
const r = await del(a, fresh());
ok(r.deleted === true, 'with a fresh sign-in and a subscription set to end, the account is deleted');
const after = await footprint(a);
const leftovers = Object.entries(after).filter(([k, n]) => n !== 0 && k !== 'billing_events');
ok(leftovers.length === 0, `every user table is empty for that user: ${JSON.stringify(after)}`);
ok(after.billing_events === 1, 'the billing event log is kept (no FK, accounting; pseudonymous id only)');
const rec = (await db.query('select stripe_customer_id, stripe_cleaned_at from private.account_deletions where user_id = $1', [a])).rows[0];
ok(rec && rec.stripe_customer_id === 'cus_a' && rec.stripe_cleaned_at === null, 'a deletion record keeps the Stripe customer id so the server can delete it at Stripe');
ok(JSON.stringify(await footprint(b)) === JSON.stringify(bBefore), "another user's data is untouched");
ok((await db.query(`select count(*)::int n from public.transcriptions t where not exists (select 1 from auth.users u where u.id = t.user_id)`)).rows[0].n === 0, 'no orphaned transcriptions anywhere');

// ---- after deletion, the old (still unexpired) access token can't write anything ----
await rejects(P.asUser(a, (d) => d.query(`insert into public.transcriptions (title, transcript_text, duration_seconds) values ('x', 'x', 1)`), fresh()), /foreign key|violates/, 'the deleted user\'s leftover token cannot create data');
ok((await del(a, fresh())).deleted === true && (await footprint(a)).auth_user === 0, 'calling it again is harmless');
await rejects(P.asUser(b, (d) => d.query('select * from private.account_deletions')), /permission denied/, 'users cannot read the deletion records');

console.log(`\n${pass} checks passed`);
