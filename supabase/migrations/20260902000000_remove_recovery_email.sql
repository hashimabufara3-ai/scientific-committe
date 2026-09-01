-- ============================================================================
-- Remove the external recovery-email feature (20260901120000_recovery_email.sql).
--
-- The recovery-email feature was removed from the product. Administrators are
-- now solely responsible for creating accounts and resetting member passwords
-- from the Admin Dashboard.
--
-- This drops ONLY recovery-email-specific objects, all guarded with IF EXISTS
-- so it is safe regardless of whether 20260901120000 was ever applied to a
-- given database:
--   - profiles.recovery_email
--   - profiles.recovery_email_confirmed_at
--   - profiles_recovery_email_unique_idx (auto-dropped with the column, kept
--     explicit for clarity)
--   - the four SECURITY DEFINER RPCs:
--       set_recovery_email(text)
--       get_recovery_email_status()
--       confirm_recovery_email()
--       clear_recovery_email()
--
-- Does NOT:
--   - touch auth.users, must_change_password, RLS/RBAC, or any shared objects
--   - remove log_audit_event() (shared) or any committee/roles machinery
--   - change the four-role model or profiles beyond the two columns above
-- ============================================================================

begin;

drop function if exists public.set_recovery_email(text);
drop function if exists public.get_recovery_email_status();
drop function if exists public.confirm_recovery_email();
drop function if exists public.clear_recovery_email();

drop index if exists public.profiles_recovery_email_unique_idx;

alter table public.profiles
  drop column if exists recovery_email_confirmed_at,
  drop column if exists recovery_email;

-- ----------------------------------------------------------------------------
-- Verification queries (read-only, safe to re-run)
-- ----------------------------------------------------------------------------
-- select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'profiles'
--     and column_name in ('recovery_email','recovery_email_confirmed_at');
--
-- select proname from pg_proc
--   where proname in ('set_recovery_email','get_recovery_email_status',
--                     'confirm_recovery_email','clear_recovery_email');

commit;