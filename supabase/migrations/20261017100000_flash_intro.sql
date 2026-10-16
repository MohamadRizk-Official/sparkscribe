-- Applied to production 2026-10-16 (additive; production reads no billing table). Rollback: supabase/proposed/rollback/20261017100000_flash_intro.down.sql
-- The Flash introductory offer ($1 for the first month, then $5.99): who is eligible, and the record that it was used.
-- Additive. The offer itself is a Stripe coupon applied by the server at Checkout (server/billing/service.js); the
-- browser can never ask for it. Rollback: supabase/proposed/rollback/20261017100000_flash_intro.down.sql
--
-- Eligibility (per Stripe mode, so test-mode purchases never affect live eligibility): an account that has never
-- had a paid subscription and has never redeemed the offer.
--   * private.billing_paid_history: set when Stripe first reports a subscription of a paid plan as active, trialing or
--     past_due (billing_apply_subscription). A first payment that is declined never reaches that state, so the
--     customer stays eligible.
--   * private.billing_promotions: set when a Checkout that carried the offer completes (the webhook). Opening or
--     abandoning Checkout consumes nothing.
-- Both are removed with the account (on delete cascade); they hold ids and timestamps only.

create table if not exists private.billing_paid_history (
  user_id       uuid not null references auth.users (id) on delete cascade,
  livemode      boolean not null,
  first_plan    text,
  first_paid_at timestamptz not null default now(),
  primary key (user_id, livemode)
);
create table if not exists private.billing_promotions (
  user_id              uuid not null references auth.users (id) on delete cascade,
  promo                text not null check (promo ~ '^[a-z0-9_]{1,40}$'),
  livemode             boolean not null,
  checkout_session     text,
  stripe_subscription  text,
  redeemed_at          timestamptz not null default now(),
  primary key (user_id, promo, livemode)
);
revoke all on private.billing_paid_history, private.billing_promotions from public, anon, authenticated;

-- May this account still get the introductory price (in this Stripe mode)?
create or replace function private.intro_eligible(p_user uuid, p_livemode boolean, p_promo text default 'flash_intro')
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null
     and not exists (select 1 from private.billing_paid_history h where h.user_id = p_user and h.livemode = p_livemode)
     and not exists (select 1 from private.billing_promotions r where r.user_id = p_user and r.promo = p_promo and r.livemode = p_livemode)
     -- backstop for subscriptions stored before this history existed
     and not exists (select 1 from public.subscriptions s where s.user_id = p_user and s.livemode = p_livemode
                       and s.plan <> 'free' and s.stripe_subscription_id is not null and s.status in ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'paused'));
$$;

-- The webhook records a completed Checkout that carried the offer. Idempotent: 'redeemed' the first time, then
-- 'already' (a second discounted subscription is a duplicate, which the webhook cancels and refunds).
create or replace function public.billing_promo_redeem(p_secret text, p_user uuid, p_promo text, p_livemode boolean,
  p_session text, p_subscription text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_billing_secret(p_secret);
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'unknown_user'; end if;
  insert into private.billing_promotions (user_id, promo, livemode, checkout_session, stripe_subscription)
  values (p_user, p_promo, p_livemode, left(p_session, 120), left(p_subscription, 120))
  on conflict (user_id, promo, livemode) do nothing;
  return case when found then 'redeemed' else 'already' end;
end;
$$;
revoke all on function public.billing_promo_redeem(text, uuid, text, boolean, text, text) from public, authenticated;
grant execute on function public.billing_promo_redeem(text, uuid, text, boolean, text, text) to anon; -- the webhook has no session; the secret is the gate

-- Same as before, plus: the first time a paid plan is active (or retrying), the account's paid history is recorded.
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
  if p_plan <> 'free' and p_status in ('active', 'trialing', 'past_due') then
    insert into private.billing_paid_history (user_id, livemode, first_plan) values (s.user_id, p_livemode, p_plan)
    on conflict (user_id, livemode) do nothing;
  end if;
  return s.user_id;
end;
$$;
revoke all on function public.billing_apply_subscription(text, text, uuid, text, text, text, text, boolean, timestamptz, timestamptz, boolean, timestamptz, timestamptz) from public, authenticated;
grant execute on function public.billing_apply_subscription(text, text, uuid, text, text, text, text, boolean, timestamptz, timestamptz, boolean, timestamptz, timestamptz) to anon;

-- billing_status: adds introEligible (everything else as in 20261016100000_four_tier.sql)
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

revoke all on all functions in schema private from public, anon, authenticated;
