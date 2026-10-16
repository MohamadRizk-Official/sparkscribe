-- ROLLBACK for 20261017100000_flash_intro.sql: removes the offer's eligibility records and restores the previous
-- billing_apply_subscription (20261011000000_phase6_billing.sql) and billing_status (20261016100000_four_tier.sql).
-- After this, every account would look eligible again: switch the offer off in the server first (unset
-- STRIPE_FLASH_INTRO_COUPON) if Checkout stays open.
drop function if exists public.billing_promo_redeem(text, uuid, text, boolean, text, text);
drop function if exists private.intro_eligible(uuid, boolean, text);
drop table if exists private.billing_promotions;
drop table if exists private.billing_paid_history;

create or replace function public.billing_apply_subscription(p_secret text, p_customer text, p_meta_user uuid,
  p_subscription text, p_status text, p_plan text, p_price text, p_livemode boolean,
  p_period_start timestamptz, p_period_end timestamptz, p_cancel_at_period_end boolean,
  p_cancel_at timestamptz, p_canceled_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.subscriptions;
begin
  perform private.check_billing_secret(p_secret);
  select * into s from public.subscriptions where stripe_customer_id = p_customer for update;
  if s.user_id is null then raise exception 'unknown_customer'; end if;
  if p_meta_user is not null and p_meta_user <> s.user_id then raise exception 'user_mismatch'; end if;
  if s.livemode <> p_livemode then raise exception 'mode_mismatch'; end if;
  -- Another subscription of the same customer: only replace the stored one if it no longer gives access
  -- or this one does (e.g. a stale "canceled" event must not overwrite a newer active subscription).
  if s.stripe_subscription_id is not null and s.stripe_subscription_id <> p_subscription
     and s.status in ('active', 'trialing', 'past_due')
     and p_status not in ('active', 'trialing', 'past_due') then
    return s.user_id;
  end if;
  if p_plan is null or not exists (select 1 from public.billing_plans where key = p_plan and billing_interval is not null) then
    p_plan := 'free';   -- unknown price: stored, but grants nothing
  end if;
  update public.subscriptions
     set stripe_subscription_id = p_subscription, status = p_status, plan = p_plan, stripe_price_id = p_price,
         current_period_start = p_period_start, current_period_end = p_period_end,
         cancel_at_period_end = coalesce(p_cancel_at_period_end, false), cancel_at = p_cancel_at,
         canceled_at = p_canceled_at, synced_at = now()
   where user_id = s.user_id;
  return s.user_id;
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
