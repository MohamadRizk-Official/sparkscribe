-- Applied to production 2026-10-14 (owner-approved, for the Stripe test-mode deletion scenario). Self-service account deletion. Requires the Phase 6 billing schema (subscriptions columns). Rollback: supabase/proposed/rollback/20261012110000_account_deletion.down.sql
--
-- Called through the server (POST /api/billing {action: "delete_account"}), which first asks
-- public.account_deletion_check(), then cancels the account's Stripe subscriptions immediately, then calls
-- public.delete_my_account('DELETE') as the signed-in user. It deletes the auth.users row; everything the
-- user owns goes with it through ON DELETE CASCADE (verified on production, read-only, 2026-10-12): profiles,
-- transcriptions (and their segments/text), transcription_insights, transcription_artifacts, transcription_questions,
-- folders, folder_items, usage, subscriptions, ai_usage (if that proposal is applied), and Supabase's own
-- auth.identities / sessions / refresh_tokens / mfa_* / one_time_tokens. Storage holds nothing (no buckets).
--
-- Guards (all enforced here, not in the browser):
--   * signed in, and the typed confirmation 'DELETE';
--   * a RECENT sign-in: the newest entry in the token's "amr" claim (Supabase records each sign-in method with a
--     timestamp) must be under 10 minutes old, so a stolen or long-lived session on a shared computer can't delete
--     the account without the password. The browser re-enters the password right before calling this.
--   * no paid subscription that would keep charging: refused with reason 'subscription' until it is canceled
--     (Stripe keeps billing a deleted user otherwise).
-- Kept after deletion, on purpose:
--   * billing_events rows (no FK; Stripe event log needed for accounting/disputes; pseudonymous user id only);
--   * one row in private.account_deletions (user id, time, Stripe customer id if any) so the server can delete the
--     Stripe customer later. No email, no content.
-- Not undoable: there is no soft-delete. On Supabase's Free plan there are no restorable backups, so it is final; on a
-- paid plan, daily backups (and point-in-time recovery, if enabled) hold the data until they rotate out.

create table if not exists private.account_deletions (
  user_id            uuid primary key,          -- no FK: the user is gone
  deleted_at         timestamptz not null default now(),
  stripe_customer_id text,
  stripe_cleaned_at  timestamptz                -- set by the server once the Stripe customer is deleted
);
revoke all on private.account_deletions from public, anon, authenticated;

-- Did the person behind this token actually sign in within the last 10 minutes?
create or replace function private.recently_signed_in() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  last_auth double precision;
begin
  select max((e ->> 'timestamp')::double precision) into last_auth
    from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) e
   where (e ->> 'timestamp') ~ '^[0-9]+(\.[0-9]+)?$'
     -- only an actual sign-in proves the person is here; a token refresh, sign-up or email change does not
     and (e ->> 'method') in ('password', 'otp', 'magiclink', 'oauth', 'totp', 'phone', 'sso/saml', 'web3', 'webauthn', 'recovery');
  return last_auth is not null and last_auth >= extract(epoch from now()) - 600;
end;
$$;
revoke all on function private.recently_signed_in() from public, anon, authenticated;

-- Asked by the server before it cancels the account's Stripe subscriptions: may this account be deleted now?
-- Deletes nothing. ('reauth' must be settled first, so a subscription is never canceled for a deletion that then
-- can't happen.)
create or replace function public.account_deletion_check()
returns json language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not private.recently_signed_in() then return json_build_object('ready', false, 'reason', 'reauth'); end if;
  return json_build_object('ready', true);
end;
$$;
revoke all on function public.account_deletion_check() from public, anon;
grant execute on function public.account_deletion_check() to authenticated;

create or replace function public.delete_my_account(p_confirm text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s_status text; s_plan text; s_cancel boolean; s_customer text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_confirm is distinct from 'DELETE' then raise exception 'type DELETE to confirm' using errcode = '22023'; end if;
  if not private.recently_signed_in() then
    return json_build_object('deleted', false, 'reason', 'reauth');
  end if;

  select status, plan, cancel_at_period_end, stripe_customer_id into s_status, s_plan, s_cancel, s_customer
    from public.subscriptions where user_id = uid;
  if s_plan is not null and s_plan <> 'free' and s_status in ('active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused')
     and not coalesce(s_cancel, false) then
    return json_build_object('deleted', false, 'reason', 'subscription');
  end if;

  insert into private.account_deletions (user_id, stripe_customer_id) values (uid, s_customer)
  on conflict (user_id) do nothing;
  delete from auth.users where id = uid;
  return json_build_object('deleted', true);
end;
$$;
revoke all on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;
