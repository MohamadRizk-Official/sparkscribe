// QA ONLY: an isolated Postgres (PGlite, in-process WebAssembly) set up like the production Supabase database:
// roles anon / authenticated / service_role, an `auth` schema with users + auth.uid() / auth.jwt(), and every
// migration applied in order — the repo's own (supabase/migrations) plus the Phase 6 billing migrations that are
// live in production but sit on the unmerged phase-6-billing branch. No network, no production data.
import { PGlite } from '@electric-sql/pglite';
import { btree_gin } from '@electric-sql/pglite/contrib/btree_gin';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BILLING_BRANCH = 'phase-6-billing';
const BILLING = ['20261011000000_phase6_billing.sql', '20261011010000_phase6_billing_hardening.sql'];

const BOOT = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema extensions;
grant usage on schema auth, extensions, public to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key default gen_random_uuid(), email text unique, encrypted_password text,
  raw_user_meta_data jsonb not null default '{}'::jsonb, raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), last_sign_in_at timestamptz
);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade, created_at timestamptz default now());
create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade, provider text not null default 'email');
-- like Supabase: the request's JWT claims arrive as a setting; auth.uid() reads "sub"
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
-- pgcrypto's digest() as Supabase installs it (extensions schema), via the built-in sha256()
create function extensions.digest(data text, type text) returns bytea language sql immutable as $$ select sha256(convert_to(data, 'UTF8')) $$;
grant execute on function extensions.digest(text, text) to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
`;

export function migrationFiles({ proposed = false } = {}) {
  const dir = (d) => readdirSync(resolve(ROOT, d)).filter((f) => f.endsWith('.sql')).map((f) => ({ name: f, sql: () => readFileSync(resolve(ROOT, d, f), 'utf8') }));
  const own = [...dir('supabase/migrations'), ...(proposed ? dir('supabase/proposed') : [])];
  const billing = BILLING.map((f) => ({ name: f, sql: () => execFileSync('git', ['show', `${BILLING_BRANCH}:supabase/migrations/${f}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) }));
  return [...own, ...billing].sort((a, b) => a.name.localeCompare(b.name));
}

export async function freshDb({ only, proposed = false } = {}) {
  const db = await PGlite.create({ extensions: { btree_gin } });
  await db.exec(BOOT);
  const applied = [];
  for (const m of migrationFiles({ proposed })) {
    if (only && !only(m.name)) continue;
    try { await db.exec(m.sql()); applied.push(m.name); }
    catch (e) { throw new Error(`migration ${m.name} failed: ${e.message}`); }
  }
  // run fn as a signed-in user (RLS applies), as an anonymous visitor, or as the service role
  const as = async (role, claims, fn) => {
    await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${JSON.stringify(claims).replace(/'/g, "''")}', false);`);
    try { return await fn(db); } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`); }
  };
  return {
    db, applied,
    asUser: (id, fn, extra = {}) => as('authenticated', { sub: id, role: 'authenticated', iat: Math.floor(Date.now() / 1000), ...extra }, fn),
    asAnon: (fn) => as('anon', { role: 'anon' }, fn),
    asService: (fn) => as('service_role', { role: 'service_role' }, fn),
    async createUser(email) {
      const { rows } = await db.query(`insert into auth.users (email) values ($1) returning id`, [email]);
      await db.query(`insert into auth.sessions (user_id) values ($1)`, [rows[0].id]);
      await db.query(`insert into auth.identities (user_id) values ($1)`, [rows[0].id]);
      return rows[0].id;
    },
  };
}
