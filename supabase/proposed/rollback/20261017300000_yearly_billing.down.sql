-- Rollback for 20261017300000_yearly_billing.sql: entitlement and billing_status exactly as before (from
-- 20261011000000_phase6_billing.sql and 20261017100000_flash_intro.sql), and no yearly price column. Run only after the
-- site no longer offers yearly plans; a yearly subscriber would then count one allowance per year again.
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

alter table public.billing_plans drop constraint if exists billing_plans_yearly_check;
alter table public.billing_plans drop column if exists yearly_price_cents;
