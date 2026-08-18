-- ============================================================================
-- Phase A: Replace the two-value user_role enum with the exact four-role model.
--
--   student < contributor < admin < owner
--
-- The old enum only knows ('student', 'admin'). We rebuild the type rather
-- than ADD VALUE so the legacy 'admin' value disappears entirely. Existing
-- rows that somehow carry 'admin' are kept as-is since 'admin' is now the
-- desired management role. The migration emits a NOTICE listing any such rows.
--
-- No Owner is bootstrapped here on purpose — that is a one-time manual step
-- (see report). The single-owner invariant is enforced by a partial unique
-- index created in the following RBAC migration.
-- ============================================================================

-- The profiles.role default references the type name; drop it before the swap.
alter table public.profiles alter column role drop default;

-- Report any legacy 'admin' rows so operators can review them.
do $$
declare
  n int;
begin
  select count(*) into n from public.profiles where role::text = 'admin';
  if n > 0 then
    raise notice 'Found % profile(s) with role "admin".', n;
  end if;
end $$;

-- Build the new four-value type under a temporary name.
create type public.user_role_new as enum ('student', 'contributor', 'admin', 'owner');

-- The "update own profile" policy references the role column in its
-- with check expression, which blocks ALTER COLUMN TYPE ("cannot alter type
-- of a column used in a policy definition"). Drop ONLY that policy here and
-- recreate it verbatim after the type swap below. "read own profile" does not
-- reference role and is left untouched.
drop policy "update own profile" on public.profiles;

-- Cast the column, preserving existing 'admin' values.
alter table public.profiles
  alter column role type public.user_role_new
  using (role::text::public.user_role_new);

-- Swap type names so every existing reference resolves to the new enum.
alter type public.user_role rename to user_role_legacy;
alter type public.user_role_new rename to user_role;
drop type public.user_role_legacy;

-- Restore the default.
alter table public.profiles alter column role set default 'student';

-- Recreate the temporarily dropped policy with its EXACT original semantics
-- (identical to 20260813194617_create_profiles.sql). The expression compares
-- the new row's role to the currently stored role — both sides use the same
-- (new) enum type — so its meaning is unchanged: users may update only their
-- own row and may never change their own role.
create policy "update own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select role from public.profiles where id = auth.uid())
  );

-- Sanity check (read-only, safe to re-run):
-- select enum_range(null::public.user_role);
