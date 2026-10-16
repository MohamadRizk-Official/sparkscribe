-- ROLLBACK for 20261016100000_four_tier.sql. Refuses if any subscription uses a new plan (roll back billing first).
-- Deletes saved Thunder history (across_items): export or confirm before running this on production.
do $$
begin
  if exists (select 1 from public.subscriptions where plan in ('flash', 'bolt', 'thunder')) then
    raise exception 'subscriptions use the new plans; not rolling back';
  end if;
end $$;
drop function if exists public.across_save(text, uuid, text, uuid[], text, jsonb, jsonb);
drop table if exists public.across_items;
delete from public.ai_plan_limits where plan in ('flash', 'bolt', 'thunder');
drop trigger if exists billing_plans_tiers on public.billing_plans;
drop function if exists private.billing_plans_check_tiers();
delete from public.billing_plans where key in ('flash', 'bolt', 'thunder');
update public.billing_plans set monthly_seconds = 3600, tagline = 'For trying SparkScribe', active = true where key = 'free';
update public.billing_plans set active = true where key in ('plus', 'pro');
alter table public.billing_plans drop constraint if exists billing_plans_intro_check;
alter table public.billing_plans drop constraint if exists billing_plans_tier_key;
alter table public.billing_plans drop column if exists tier, drop column if exists features,
  drop column if exists intro_price_cents, drop column if exists intro_months;
-- billing_status() as in 20261015100000_launch_integrity.sql
create or replace function public.billing_status()
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  e record;
  s public.subscriptions;
  bs public.billing_settings;
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into e from private.entitlement(uid);
  select * into s from public.subscriptions where user_id = uid;
  select * into bs from public.billing_settings where id;
  return json_build_object(
    'plan', e.plan, 'planName', e.plan_name, 'status', e.status,
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
