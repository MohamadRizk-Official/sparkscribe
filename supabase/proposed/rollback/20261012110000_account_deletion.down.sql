-- ROLLBACK for 20261012110000_account_deletion.sql. Not applied anywhere.
-- First hide the button: remove VITE_ACCOUNT_DELETION from the build env and redeploy (or leave it; the dialog then
-- says deleting isn't switched on and nothing is deleted). Accounts already deleted cannot be brought back.
drop function if exists public.delete_my_account(text);
drop function if exists public.account_deletion_check();
drop function if exists private.recently_signed_in();
-- private.account_deletions lists Stripe customers still to clean up; keep it unless that list is empty or exported.
-- drop table if exists private.account_deletions;
