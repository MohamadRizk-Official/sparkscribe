-- Rollback of 20261027100000_unlimited_accounts.sql: the four functions exactly as they were before it (from
-- 20261017300000_yearly_billing.sql, 20261011000000_phase6_billing.sql and 20261012100000_ai_usage_limits.sql), then
-- the list and its helper are dropped. Accounts that were on the list go back to their real plan (Free unless they
-- pay); their usage rows stay as recorded. Tested in qa/sql/unlimited-accounts.test.mjs.

create or replace function private.entitlement(p_user uuid, p_at timestamptz default now())
returns table (
  plan text, plan_name text, status text, monthly_seconds integer, used_seconds numeric,
  period_start timestamptz, period_end timestamptz, period_kind text,
  cancel_at_period_end boolean, has_billing_account boolean, payment_problem boolean, livemode boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare
  bs public.billing_settings;
  s public.subscriptions;
  p public.billing_plans;
  paid boolean := false;
  starts timestamptz;
  k integer;
begin
  select * into bs from public.billing_settings where id;
  select * into s from public.subscriptions where user_id = p_user;
  if s.user_id is not null and s.livemode = bs.stripe_livemode
     and s.status in ('active', 'trialing', 'past_due') and s.plan <> 'free'
     and s.current_period_start is not null and s.current_period_end is not null
     and s.current_period_end > p_at - interval '2 days' then   -- small grace if a renewal webhook is late
    select * into p from public.billing_plans where key = s.plan;
    paid := p.key is not null;
  end if;

  if paid then
    plan := p.key; plan_name := p.name; monthly_seconds := p.monthly_seconds;
    status := s.status; period_start := s.current_period_start; period_end := s.current_period_end; period_kind := 'billing';
    -- a yearly subscription: the allowance renews every month, counted from the subscription period's start
    if s.current_period_end - s.current_period_start > interval '35 days' then
      k := greatest((extract(year from age(p_at, s.current_period_start)) * 12 + extract(month from age(p_at, s.current_period_start)))::integer, 0);
      -- settle k so that start + k months <= p_at < start + (k + 1) months (age() rounds around month ends)
      while s.current_period_start + make_interval(months => k + 1) <= p_at loop k := k + 1; end loop;
      while k > 0 and s.current_period_start + make_interval(months => k) > p_at loop k := k - 1; end loop;
      period_start := s.current_period_start + make_interval(months => k);
      period_end := least(s.current_period_start + make_interval(months => k + 1), s.current_period_end);
      period_kind := 'billing_month';
    end if;
    -- a period that ended without a renewal webhook yet: keep counting from its start
    if period_end <= p_at then period_end := p_at + interval '1 second'; end if;
  else
    select * into p from public.billing_plans where is_default;
    plan := p.key; plan_name := p.name; monthly_seconds := p.monthly_seconds;
    status := 'free';
    period_start := date_trunc('month', p_at at time zone 'utc') at time zone 'utc';  -- calendar month, UTC
    period_end := (date_trunc('month', p_at at time zone 'utc') + interval '1 month') at time zone 'utc';
    period_kind := 'calendar_month';
  end if;

  cancel_at_period_end := paid and coalesce(s.cancel_at_period_end, false);
  has_billing_account := coalesce(s.stripe_customer_id is not null and s.livemode = bs.stripe_livemode, false);
  payment_problem := coalesce(s.livemode = bs.stripe_livemode and s.status in ('past_due', 'unpaid', 'incomplete'), false);
  livemode := bs.stripe_livemode;

  starts := greatest(period_start, bs.metering_starts_at);
  if bs.metering_starts_at is null then
    used_seconds := 0;
  else
    select coalesce(sum(u.seconds), 0) into used_seconds from public.usage u
     where u.user_id = p_user and u.created_at >= starts and u.created_at < period_end;
  end if;
  return next;
end;
$$;
revoke all on function private.entitlement(uuid, timestamptz) from public, anon, authenticated;

create or replace function private.on_transcription_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  e record;
  secs numeric;
begin
  secs := private.billable_seconds(new.duration_seconds, new.segments, new.transcript_text);
  perform pg_advisory_xact_lock(hashtextextended('sparkscribe:usage:' || new.user_id::text, 0));
  select * into e from private.entitlement(new.user_id);
  if private.quota_enforced() and e.used_seconds + secs > e.monthly_seconds + 1 then
    raise exception 'quota_exceeded'
      using errcode = 'P0001',
            detail = json_build_object('plan', e.plan, 'remainingSeconds', greatest(e.monthly_seconds - e.used_seconds, 0), 'requestedSeconds', secs)::text,
            hint = 'This transcription is longer than the time left on your plan this month.';
  end if;
  insert into public.usage (user_id, transcription_id, seconds, plan, billing_period_start, billing_period_end)
  values (new.user_id, new.id, secs, e.plan, e.period_start, e.period_end)
  on conflict (transcription_id) do nothing;
  return new;
end;
$$;

create or replace function public.billing_status()
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  e record;
  s public.subscriptions;
  bs public.billing_settings;
  p public.billing_plans;
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into e from private.entitlement(uid);
  select * into s from public.subscriptions where user_id = uid;
  select * into bs from public.billing_settings where id;
  select * into p from public.billing_plans where key = e.plan;
  return json_build_object(
    'plan', e.plan, 'planName', e.plan_name, 'status', e.status,
    'tier', p.tier, 'features', coalesce(p.features, '{}'::text[]),
    'introEligible', private.intro_eligible(uid, bs.stripe_livemode),
    'monthlySeconds', e.monthly_seconds, 'usedSeconds', e.used_seconds,
    'remainingSeconds', greatest(e.monthly_seconds - e.used_seconds, 0),
    'periodStart', e.period_start, 'periodEnd', e.period_end, 'periodKind', e.period_kind,
    'billingInterval', case e.period_kind when 'billing' then 'month' when 'billing_month' then 'year' end,
    'renewsAt', case when e.period_kind in ('billing', 'billing_month') then s.current_period_end end,
    'cancelAtPeriodEnd', e.cancel_at_period_end, 'hasBillingAccount', e.has_billing_account,
    'paymentProblem', e.payment_problem,
    'subscriptionStatus', case when s.livemode = bs.stripe_livemode then s.status end,
    'meteringStarted', bs.metering_starts_at is not null,
    'enforced', private.quota_enforced()
  );
end;
$$;
revoke all on function public.billing_status() from public, anon;
grant execute on function public.billing_status() to authenticated;

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

drop function if exists private.is_unlimited(uuid);
drop table if exists private.unlimited_accounts;
