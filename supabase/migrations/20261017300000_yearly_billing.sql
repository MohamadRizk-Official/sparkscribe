-- Applied to production 2026-10-17 (no subscriptions existed; Free/monthly behaviour unchanged, see qa/sql/yearly-billing.test.mjs).
-- Yearly billing (owner decision 2026-10-17): Flash $59/yr, Bolt $99/yr, Thunder $149/yr, each with the plan's normal
-- monthly allowance renewed every billing month. The $1 first month stays a monthly-only offer (decided by the server,
-- which never adds the coupon to a yearly checkout).
--
-- 1. billing_plans.yearly_price_cents: the yearly price shown on the site (display; what is charged is the Stripe
--    price the server picks, STRIPE_<PLAN>_YEARLY_PRICE_ID).
-- 2. private.entitlement: a paid subscription whose billing period is longer than a month (a yearly one) is split into
--    monthly allowance windows counted from the subscription's start (Jan 31 -> Feb 28 -> Mar 31 ...). Monthly
--    subscriptions and Free are computed exactly as before. Every caller (billing_status, the quota check when a
--    transcription is saved, the usage ledger's period columns, ai_reserve's monthly AI budget) uses these windows,
--    so a yearly subscriber gets the plan's allowance and AI budget every month, not once a year.
-- 3. billing_status: adds billingInterval ('month' | 'year' | null) and renewsAt (when the subscription itself renews
--    or ends; periodEnd stays "when the allowance renews").
--
-- Safety review (2026-10-17)
--   * Additive column (nullable, check-constrained); existing plan rows only gain a yearly price.
--   * The two functions keep their signatures and grants (create or replace), so nothing that calls them changes.
--     No subscription today has a period longer than 35 days, so every current result is identical (tested).
--   * Usage rows are never rewritten; only how a period is chosen for new ones and for counting.
--   * Rollback: supabase/proposed/rollback/20261017300000_yearly_billing.down.sql (restores both functions as they
--     were and drops the column; tested in qa/sql/yearly-billing.test.mjs).

-- 1 ---------------------------------------------------------------------------------------------------------------
alter table public.billing_plans
  add column if not exists yearly_price_cents integer check (yearly_price_cents is null or yearly_price_cents > 0);
alter table public.billing_plans drop constraint if exists billing_plans_yearly_check;
alter table public.billing_plans add constraint billing_plans_yearly_check
  check (yearly_price_cents is null or (billing_interval is not null and billing_interval = 'month' and price_cents > 0));
update public.billing_plans set yearly_price_cents = case key when 'flash' then 5900 when 'bolt' then 9900 when 'thunder' then 14900 end
 where key in ('flash', 'bolt', 'thunder');

-- 2 ---------------------------------------------------------------------------------------------------------------
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

-- 3 ---------------------------------------------------------------------------------------------------------------
-- billing_status: adds billingInterval and renewsAt (everything else as in 20261017100000_flash_intro.sql)
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
