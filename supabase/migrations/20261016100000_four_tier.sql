-- Applied to production 2026-10-16 (stage 1 only: additive; production reads no billing table, metering is off). Rollback: supabase/proposed/rollback/20261016100000_four_tier.down.sql
-- Four plans (Free / Flash / Bolt / Thunder), plan capabilities, their AI limits, and saved Thunder history.
-- Stage 1 of 2. Additive and backward compatible: safe to apply while the current production site runs.
--   * The current production build (main) reads no billing table. Previews built from prelaunch/dev list plans with
--     active = true; the three new plans are inserted with active = false, so nothing changes for them.
--   * Free becomes 30 minutes (owner-approved product change, 2026-10-15). No account is affected today: usage is
--     only counted from billing_settings.metering_starts_at, which is still unset (nothing counts, nothing is
--     enforced), and when it is set at launch, recordings saved before it are never counted.
--   * Plus and Pro stay as rows (historical references; no subscription uses them), outside the four-tier lineup.
-- Stage 2 (supabase/proposed/20261016110000_four_tier_cutover.sql) only switches which plans are public, at release.
-- Rollback: supabase/proposed/rollback/20261016100000_four_tier.down.sql

-- 1. The plan catalogue -------------------------------------------------------------------------------------------
-- tier: the plan's place in the four-tier lineup (0 Free … 3 Thunder); null = a retired plan (Plus, Pro). A higher
--   tier includes every capability of the lower ones (checked by the tests, and by the constraint trigger below).
-- features: the premium capabilities the plan grants. The core app (transcription, Summary, Notes, Ask on one
--   recording, flashcards, quizzes with difficulty / exam focus / per-question review and retakes, study guides,
--   Create tools, exports) is on every plan and needs no entry here.
-- intro_price_cents / intro_months: an introductory price for the first billing period(s) (Flash: $1 for one month).
--   Display only: what Checkout charges is decided by the server and Stripe (Phase 4), never by this column alone.
alter table public.billing_plans
  add column if not exists tier smallint check (tier between 0 and 9),
  add column if not exists features text[] not null default '{}'
    check (features <@ array['focused_review', 'followup_practice', 'across_ask', 'across_guide']::text[]),
  add column if not exists intro_price_cents integer check (intro_price_cents >= 0),
  add column if not exists intro_months smallint check (intro_months between 1 and 12);
alter table public.billing_plans drop constraint if exists billing_plans_tier_key;
alter table public.billing_plans add constraint billing_plans_tier_key unique (tier);
alter table public.billing_plans drop constraint if exists billing_plans_intro_check;
alter table public.billing_plans add constraint billing_plans_intro_check check (
  (intro_price_cents is null) = (intro_months is null)
  and (intro_price_cents is null or (billing_interval is not null and intro_price_cents < price_cents)));

update public.billing_plans set tier = 0, features = '{}', monthly_seconds = 1800, tagline = 'Try the real product'
 where key = 'free';
insert into public.billing_plans
  (key, name, tagline, price_cents, currency, billing_interval, monthly_seconds, sort_order, is_default, active, tier, features, intro_price_cents, intro_months)
values
  ('flash',   'Flash',   'Everyday studying',    599,  'usd', 'month', 10800, 1, false, false, 1, '{}', 100, 1),                       -- 3 hours
  ('bolt',    'Bolt',    'Focused Review',       999,  'usd', 'month', 32400, 2, false, false, 2, '{focused_review,followup_practice}', null, null),  -- 9 hours
  ('thunder', 'Thunder', 'Connected recordings', 1499, 'usd', 'month', 72000, 3, false, false, 3, '{focused_review,followup_practice,across_ask,across_guide}', null, null) -- 20 hours
on conflict (key) do nothing;

-- a higher tier never has fewer capabilities than a lower one
create or replace function private.billing_plans_check_tiers() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.billing_plans lo join public.billing_plans hi on hi.tier > lo.tier
     where not (lo.features <@ hi.features)
  ) then
    raise exception 'a higher plan must include every capability of the lower plans' using errcode = '23514';
  end if;
  return null;
end;
$$;
drop trigger if exists billing_plans_tiers on public.billing_plans;
create constraint trigger billing_plans_tiers after insert or update on public.billing_plans
  deferrable initially deferred for each row execute function private.billing_plans_check_tiers();

-- 2. AI limits for the new plans ----------------------------------------------------------------------------------
-- Model-cost budgets per billing period (docs/launch/19-four-tier-entitlements.md has the cost basis). A plan without
-- a row still gets the Free limits (ai_reserve), never none.
insert into public.ai_plan_limits (plan, actions_per_hour, monthly_budget_microusd) values
  ('flash',   60,  750000),    -- ~$0.75 a period (12.5% of $5.99)
  ('bolt',    120, 1500000),   -- ~$1.50 (15% of $9.99)
  ('thunder', 240, 3000000)    -- ~$3.00 (20% of $14.99)
on conflict (plan) do nothing;

-- 3. What the signed-in user's plan includes (adds tier and features; everything else as before) ----------------
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

-- 4. Saved Thunder history: questions and combined study guides across recordings ---------------------------------
-- One row per answer or guide. The server writes rows (across_save, with its secret) right after generating them, so
-- a row always holds what the AI actually produced from recordings the user owns; users can read and delete their own
-- rows, never insert or change them. No audio and no transcript text is copied here: answers keep citations
-- ([R2:45]) and speaker / recording tokens ({{R2.S1}}, {{R2}}) that are resolved against the recordings when shown, so
-- renamed speakers and recordings show their current names. `sources` is a snapshot of each recording (id, label,
-- title, version, transcript fingerprint) so deleted and edited recordings can be flagged.
-- Kept after a plan ends (readable on every plan); removed with the account (on delete cascade) or by the user.
create table if not exists public.across_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  request_id   uuid not null,                  -- chosen by the browser per request: a retried save is stored once
  kind         text not null check (kind in ('ask', 'guide')),
  set_key      text not null check (length(set_key) <= 600),   -- the sorted recording ids: groups a selection's history
  recording_ids uuid[] not null check (cardinality(recording_ids) between 2 and 12),
  question     text check (length(question) <= 600),
  content      jsonb not null check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 65536),
  sources      jsonb not null check (jsonb_typeof(sources) = 'array' and pg_column_size(sources) <= 16384),
  created_at   timestamptz not null default now(),
  constraint across_items_request_key unique (user_id, request_id),
  constraint across_items_question_kind_check check ((kind = 'ask') = (question is not null))
);
create index if not exists across_items_user_set_idx on public.across_items (user_id, set_key, created_at desc);
create index if not exists across_items_user_created_idx on public.across_items (user_id, created_at desc);
alter table public.across_items enable row level security;
revoke all on public.across_items from anon, authenticated;
grant select, delete on public.across_items to authenticated;
drop policy if exists "across_items: read own" on public.across_items;
create policy "across_items: read own" on public.across_items for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "across_items: delete own" on public.across_items;
create policy "across_items: delete own" on public.across_items for delete to authenticated using ((select auth.uid()) = user_id);

-- Store one generated answer or guide for the signed-in user. Server only (BILLING_DB_SECRET); the user is always
-- auth.uid(). Every recording must belong to that user. Idempotent per request id. At most 500 items per account:
-- beyond that nothing is deleted automatically; the save is refused and the page asks the user to remove old items.
create or replace function public.across_save(p_secret text, p_request uuid, p_kind text, p_ids uuid[], p_question text,
  p_content jsonb, p_sources jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  ids uuid[];
  r public.across_items;
  n integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform private.check_billing_secret(p_secret);
  if p_request is null then raise exception 'bad request' using errcode = '22023'; end if;
  select array_agg(distinct x order by x) into ids from unnest(p_ids) x where x is not null;
  if ids is null or cardinality(ids) < 2 or cardinality(ids) > 12 then raise exception 'bad selection' using errcode = '22023'; end if;
  -- only the caller's own recordings (security definer: checked here explicitly)
  if (select count(*) from public.transcriptions t where t.id = any (ids) and t.user_id = uid) <> cardinality(ids) then
    raise exception 'unknown recording' using errcode = '22023';
  end if;
  -- the snapshot names exactly the selected recordings
  if jsonb_typeof(p_sources) is distinct from 'array'
     or exists (select 1 from jsonb_array_elements(p_sources) s
                 where jsonb_typeof(s) <> 'object' or coalesce(s ->> 'id', '') !~ '^[0-9a-f-]{36}$' or not ((s ->> 'id')::uuid = any (ids))) then
    raise exception 'bad sources' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sparkscribe:across:' || uid::text, 0));
  select * into r from public.across_items where user_id = uid and request_id = p_request;
  if found then return json_build_object('saved', true, 'id', r.id, 'created_at', r.created_at, 'duplicate', true); end if;
  select count(*) into n from public.across_items where user_id = uid;
  if n >= 500 then return json_build_object('saved', false, 'reason', 'full', 'limit', 500); end if;
  insert into public.across_items (user_id, request_id, kind, set_key, recording_ids, question, content, sources)
  values (uid, p_request, p_kind, array_to_string(ids, ','), ids, case when p_kind = 'ask' then left(p_question, 600) end, p_content, p_sources)
  returning * into r;
  return json_build_object('saved', true, 'id', r.id, 'created_at', r.created_at);
end;
$$;
revoke all on function public.across_save(text, uuid, text, uuid[], text, jsonb, jsonb) from public, anon;
grant execute on function public.across_save(text, uuid, text, uuid[], text, jsonb, jsonb) to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
