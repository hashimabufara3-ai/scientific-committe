-- ============================================================================
-- Phase 2B: Committee Member Account Creation
-- ============================================================================
-- This migration adds:
--   1. admin_create_committee_member_private() — insert father_name
--   2. set_must_change_password() — mark profile for forced password change
--   3. clear_must_change_password() — clear the flag after password is changed
--
-- The account creation flow is:
--   a. Admin creates auth user via Supabase Admin API (service-role key)
--   b. handle_new_user() trigger fires → profiles row created
--   c. set_must_change_password(true) called on the new profile
--   d. admin_create_committee_member() called with user_id
--   e. admin_create_committee_member_private() called for father_name
--   f. log_audit_event() records the creation
--
-- NOTE: This migration does NOT modify any existing data or tables.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. admin_create_committee_member_private: insert father_name for a member.
--    Called immediately after admin_create_committee_member() in the account
--    creation flow. SECURITY DEFINER bypasses the lack of public INSERT policy.
-- ----------------------------------------------------------------------------
create or replace function public.admin_create_committee_member_private(
  p_committee_member_id uuid,
  p_father_name         text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  if not exists (
    select 1 from public.committee_members where id = p_committee_member_id
  ) then
    raise exception 'committee member not found';
  end if;

  insert into public.committee_member_private (committee_member_id, father_name)
  values (p_committee_member_id, btrim(p_father_name))
  on conflict (committee_member_id) do update
    set father_name = btrim(excluded.father_name);
end;
$$;

revoke all on function public.admin_create_committee_member_private(uuid, text) from public;
grant execute on function public.admin_create_committee_member_private(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. set_must_change_password: mark or unmark a profile for forced password
--    change. SECURITY DEFINER so admins can set this on other users.
--    Cannot be called by non-admins on other users' profiles.
-- ----------------------------------------------------------------------------
create or replace function public.set_must_change_password(
  p_user_id            uuid,
  p_must_change boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user not found';
  end if;

  update public.profiles
     set must_change_password = p_must_change
   where id = p_user_id;
end;
$$;

revoke all on function public.set_must_change_password(uuid, boolean) from public;
grant execute on function public.set_must_change_password(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. clear_must_change_password: self-service. Users call this after they
--    successfully change their own password. SECURITY DEFINER so the row-
--    level "update own profile" policy (which restricts column changes)
--    does not block the must_change_password → false transition.
-- ----------------------------------------------------------------------------
create or replace function public.clear_must_change_password()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.profiles
     set must_change_password = false
   where id = auth.uid()
     and must_change_password = true;
end;
$$;

revoke all on function public.clear_must_change_password() from public;
grant execute on function public.clear_must_change_password() to authenticated;
