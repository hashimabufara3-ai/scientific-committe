-- ============================================================================
-- Phase A: Admin member-management privacy.
--
-- The Admin Dashboard does not need other members' email addresses. The broad
-- "admins can read all profiles" SELECT policy exposed profiles.email (and the
-- rest of every row) to all admin/owner accounts. Replace it with a
-- dedicated SECURITY DEFINER RPC, admin_list_members(), that returns ONLY:
--   id, full_name, role, created_at
-- and verifies the caller is an admin or owner via auth.uid() (never from
-- client input). "read own profile" stays intact: every user still reads only
-- their own row, and own-account email remains readable by its owner.
--
-- Also backfills empty full_name values from the exact source the signup
-- trigger already uses (auth.users.raw_user_meta_data -> 'full_name'). Names
-- are never invented and email is never used as a name fallback.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Remove the broad admin read policy. It exists only for the member
--    management UI, which now reads through admin_list_members().
-- ----------------------------------------------------------------------------
drop policy if exists "admins can read all profiles" on public.profiles;

-- ----------------------------------------------------------------------------
-- 2. Backfill blank full_name values from signup metadata (mirrors the source
--    handle_new_user() reads at signup). Only blank names are touched.
-- ----------------------------------------------------------------------------
update public.profiles p
   set full_name = u.raw_user_meta_data ->> 'full_name'
  from auth.users u
 where u.id = p.id
   and btrim(p.full_name) = ''
   and nullif(btrim(u.raw_user_meta_data ->> 'full_name'), '') is not null;

-- ----------------------------------------------------------------------------
-- 3. admin_list_members: server-authorized member listing/search for the Admin
--    Dashboard. Returns ONLY id, full_name, role, created_at — never email.
--    The actor is always derived from auth.uid() and must be admin/owner.
--    Search operates on full_name only (case-insensitive substring).
-- ----------------------------------------------------------------------------
create or replace function public.admin_list_members(search text default null)
returns table (
  id uuid,
  full_name text,
  role public.user_role,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_role public.user_role;
begin
  select role into actor_role from public.profiles where id = auth.uid();
  if actor_role is null
     or actor_role not in ('admin'::public.user_role, 'owner'::public.user_role) then
    raise exception 'insufficient privileges';
  end if;

  if search is null or btrim(search) = '' then
    return query
      select p.id, p.full_name, p.role, p.created_at
        from public.profiles p
       order by p.created_at asc;
  else
    return query
      select p.id, p.full_name, p.role, p.created_at
        from public.profiles p
       where position(lower(search) in lower(p.full_name)) > 0
       order by p.created_at asc;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Least-privilege grants: authenticated callers only, never PUBLIC.
-- ----------------------------------------------------------------------------
revoke all on function public.admin_list_members(text) from public;
grant execute on function public.admin_list_members(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Verification queries (read-only, safe to re-run)
-- ----------------------------------------------------------------------------
-- select policyname from pg_policies where schemaname = 'public' and tablename = 'profiles';
-- select proname, prosecdef from pg_proc where proname = 'admin_list_members';
-- select id, full_name, role, created_at from public.admin_list_members();
