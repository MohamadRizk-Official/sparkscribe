-- Applied to production 2026-10-15 (owner-approved for launch). Rollback: supabase/proposed/rollback/20261012100000_ai_usage_limits.down.sql
-- per-user AI usage limits, enforced in the database. Requires the Phase 6 billing schema.
--
-- Why in the database: the server talks to Postgres AS the signed-in user, so anything the server can write, the
-- browser can write too. A limit kept in ordinary rows can be reset or evaded (deleting results, regenerating the
-- same row). Here:
--   * ai_usage is an append-only ledger: one row per model call batch ("AI action"). Users can read their own rows;
--     they can't insert, change or delete any (no grants). Rows go away only with the account (on delete cascade).
--   * ai_reserve() is the only way to add a row. It serializes each user's reservations with an advisory lock, so
--     concurrent requests can't all slip under the limit, then counts the last hour's actions and this period's spend
--     against the user's plan, and either inserts a 'reserved' row or refuses.
--   * ai_settle() records the real token counts and cost after the call. It needs the server-only secret (same
--     mechanism as billing), so a user can't report a cheaper cost than the call actually had.
--   * Limits live per plan in ai_plan_limits. Nothing is enforced until billing_settings.enforce_ai_limits is turned
--     on (or the request comes from an origin in enforce_origins, e.g. a Preview), so applying this changes nothing.

alter table public.billing_settings add column if not exists enforce_ai_limits boolean not null default false;
-- Service-wide circuit breaker: total AI model spend (all users) allowed in any 24 hours, in micro-dollars. Applies
-- whether or not per-user limits are enforced; null switches it off. Starts at $5/day; change with an UPDATE.
alter table public.billing_settings add column if not exists ai_daily_budget_microusd integer default 5000000
  check (ai_daily_budget_microusd is null or ai_daily_budget_microusd > 0);

create table public.ai_plan_limits (
  plan              text primary key references public.billing_plans (key),
  actions_per_hour  integer not null check (actions_per_hour > 0),
  monthly_budget_microusd integer not null check (monthly_budget_microusd > 0)   -- 1,000,000 = $1.00 of model cost
);
alter table public.ai_plan_limits enable row level security;
revoke all on public.ai_plan_limits from anon, authenticated;
grant select on public.ai_plan_limits to authenticated;
create policy "ai_plan_limits: anyone signed in can read" on public.ai_plan_limits for select to authenticated using (true);
-- starting values (see qa/REPORT.md for the cost basis); change with an UPDATE, no deploy needed
insert into public.ai_plan_limits (plan, actions_per_hour, monthly_budget_microusd) values
  ('free', 20, 150000),     -- ~$0.15 of model cost a month
  ('plus', 120, 1500000),   -- ~$1.50 (about 19% of $7.99)
  ('pro', 240, 3500000)     -- ~$3.50 (about 23% of $14.99)
on conflict (plan) do nothing;

create table public.ai_usage (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  feature       text not null check (length(feature) <= 80),
  status        text not null default 'reserved' check (status in ('reserved', 'done', 'failed')),
  estimate_microusd integer not null default 0 check (estimate_microusd >= 0),
  cost_microusd integer check (cost_microusd >= 0),
  input_tokens  integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  created_at    timestamptz not null default now(),
  settled_at    timestamptz
);
create index ai_usage_user_created_idx on public.ai_usage (user_id, created_at);
create index ai_usage_created_idx on public.ai_usage (created_at);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;
create policy "ai_usage: read own" on public.ai_usage for select to authenticated using ((select auth.uid()) = user_id);

-- Enforced for this request? (everywhere once switched on; before that only for listed origins, like the quota)
create or replace function private.ai_limits_enforced() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  bs public.billing_settings;
  origin text;
begin
  select * into bs from public.billing_settings where id;
  if bs.enforce_ai_limits then return true; end if;
  -- AI calls come from the server, which names its own deployment in x-sparkscribe-origin (from Vercel's env, not
  -- from the browser); a browser's Origin is the fallback. This only ever adds enforcement for listed origins.
  begin origin := coalesce(current_setting('request.headers', true)::json ->> 'x-sparkscribe-origin',
                           current_setting('request.headers', true)::json ->> 'origin', '');
  exception when others then origin := ''; end;
  return origin <> '' and origin = any (bs.enforce_origins);
end;
$$;

-- Reserve one AI action for the signed-in user. Never takes a user id. p_estimate_microusd = the server's estimate
-- of this call's cost (counted until the call is settled). The estimate is trusted only with the server's secret
-- (p_secret, same as the billing functions) and is capped per action: a user calling this directly over the API is
-- counted as an action with a zero estimate, so nobody can fill the service-wide daily total and pause the AI for
-- everyone.
create or replace function public.ai_reserve(p_feature text, p_estimate_microusd integer default 0, p_secret text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  e record;
  lim public.ai_plan_limits;
  enforced boolean := private.ai_limits_enforced();
  hour_count integer;
  spent bigint;
  daily_budget integer;
  spent_today bigint;
  new_id bigint;
  secret_hash bytea;
  est integer := 0;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select hash into secret_hash from private.billing_secrets where name = 'server';
  if secret_hash is not null and p_secret is not null and extensions.digest(p_secret, 'sha256') = secret_hash then
    est := least(greatest(coalesce(p_estimate_microusd, 0), 0), 250000); -- at most $0.25 per action
  end if;
  if p_feature is null or length(p_feature) = 0 or length(p_feature) > 80 then raise exception 'bad feature' using errcode = '22023'; end if;
  -- one reservation at a time per user: concurrent requests queue here instead of all passing the check
  perform pg_advisory_xact_lock(hashtextextended('sparkscribe:ai:' || uid::text, 0));
  select * into e from private.entitlement(uid);
  select * into lim from public.ai_plan_limits where plan = e.plan;
  -- a plan without its own row (e.g. one added later) gets the Free limits, never none
  if lim.plan is null then select * into lim from public.ai_plan_limits where plan = 'free'; end if;
  select count(*) into hour_count from public.ai_usage where user_id = uid and created_at > now() - interval '1 hour';
  select coalesce(sum(coalesce(cost_microusd, estimate_microusd)), 0) into spent from public.ai_usage
   where user_id = uid and created_at >= e.period_start and created_at < e.period_end and status <> 'failed';
  -- always on, enforced or not: a ceiling no real use comes near, so direct calls can't flood the ledger
  if hour_count >= 1000 then
    return json_build_object('allowed', false, 'reason', 'hourly', 'plan', e.plan, 'limit', 1000, 'retry_after_s', 3600);
  end if;
  -- service-wide breaker (last 24 h, every user, real cost where known); not serialized across users, so a burst
  -- can pass it by at most the requests already in flight
  select ai_daily_budget_microusd into daily_budget from public.billing_settings where id;
  if daily_budget is not null then
    select coalesce(sum(coalesce(cost_microusd, estimate_microusd)), 0) into spent_today from public.ai_usage
     where created_at > now() - interval '24 hours';
    if spent_today + est > daily_budget then
      return json_build_object('allowed', false, 'reason', 'paused');
    end if;
  end if;
  -- enforced but the limits can't be determined: refuse rather than run unmetered
  if enforced and (lim.plan is null or e.period_start is null or e.period_end is null) then
    return json_build_object('allowed', false, 'reason', 'unavailable');
  end if;
  if enforced then
    if hour_count >= lim.actions_per_hour then
      return json_build_object('allowed', false, 'reason', 'hourly', 'plan', e.plan, 'limit', lim.actions_per_hour,
        'retry_after_s', greatest(1, ceil(extract(epoch from (
          (select min(created_at) from (select created_at from public.ai_usage where user_id = uid and created_at > now() - interval '1 hour' order by created_at desc limit lim.actions_per_hour) x)
          + interval '1 hour' - now())))::int));
    end if;
    if spent + est > lim.monthly_budget_microusd then
      return json_build_object('allowed', false, 'reason', 'monthly', 'plan', e.plan, 'period_end', e.period_end);
    end if;
  end if;
  insert into public.ai_usage (user_id, feature, estimate_microusd) values (uid, p_feature, est)
  returning id into new_id;
  return json_build_object('allowed', true, 'id', new_id, 'enforced', enforced, 'plan', e.plan,
    'hour_used', hour_count + 1, 'hour_limit', lim.actions_per_hour, 'spent_microusd', spent, 'budget_microusd', lim.monthly_budget_microusd);
end;
$$;
revoke all on function public.ai_reserve(text, integer, text) from public, anon;
grant execute on function public.ai_reserve(text, integer, text) to authenticated;

-- Record the real usage of a reserved action. Server only (secret). A failed call keeps its row and its real cost
-- (for the service-wide total and your accounting) and still counts toward the hourly limit, but not toward the
-- user's monthly allowance: users aren't charged for our failures.
create or replace function public.ai_settle(p_secret text, p_id bigint, p_ok boolean, p_input_tokens integer, p_output_tokens integer, p_cost_microusd integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_billing_secret(p_secret);
  update public.ai_usage
     set status = case when p_ok then 'done' else 'failed' end,
         input_tokens = greatest(coalesce(p_input_tokens, 0), 0), output_tokens = greatest(coalesce(p_output_tokens, 0), 0),
         cost_microusd = greatest(coalesce(p_cost_microusd, 0), 0), settled_at = now()
   where id = p_id and user_id = auth.uid() and status = 'reserved';
end;
$$;
revoke all on function public.ai_settle(text, bigint, boolean, integer, integer, integer) from public, anon;
grant execute on function public.ai_settle(text, bigint, boolean, integer, integer, integer) to authenticated;
