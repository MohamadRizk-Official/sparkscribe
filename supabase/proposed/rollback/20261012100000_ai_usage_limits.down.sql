-- ROLLBACK for 20261012100000_ai_usage_limits.sql. Not applied anywhere.
-- Before running: remove AI_LIMITS_REQUIRED from the server env and redeploy (otherwise the missing function makes
-- every AI request fail closed). Usually not needed at all: `update public.billing_settings set enforce_ai_limits = false`
-- switches enforcement off instantly without dropping anything.
-- Drops the AI usage history (ai_usage). No user content is touched.
update public.billing_settings set enforce_ai_limits = false;
drop function if exists public.ai_settle(text, bigint, boolean, integer, integer, integer);
drop function if exists public.ai_reserve(text, integer);
drop function if exists private.ai_limits_enforced();
drop table if exists public.ai_usage;
drop table if exists public.ai_plan_limits;
alter table public.billing_settings drop column if exists enforce_ai_limits;
alter table public.billing_settings drop column if exists ai_daily_budget_microusd;
