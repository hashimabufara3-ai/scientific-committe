-- ============================================================================
-- Phase A: role management — helpers, guarded role assignment, atomic owner
-- transfer, single-owner invariant, and the admin profile-read policy.
--
-- Authorization model
--   * The only paths that change roles are the two SECURITY DEFINER functions
--     below. The client (anon/authenticated keys) can never write roles
--     directly: profiles RLS keeps updates to the caller's own row and forces
--     the role to stay unchanged (see 20260813194617_create_profiles.sql), and
--     there are no INSERT/DELETE grants on profiles.
--   * No service_role key is ever used by application code.
--   * assign_role() enforces an explicit transition allowlist. It can never
--     assign 'owner' and can never modify the Owner row. No-op changes and
--     self-changes are rejected. The actor is always derived from auth.uid().
--   * transfer_ownership() is the ONLY operation that changes the Owner row.
--     It is owner-only, rejects self/nonexistent targets, and demotes the
--     current owner then promotes the target in two guarded UPDATEs. Both run
--     inside the caller's transaction, so any failure rolls everything back —
--     no observable two-owner or zero-owner state can be committed.
--   * A partial unique index guarantees at most one 'owner' row even under
--     concurrent transfers (the loser aborts on the index violation).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. current_role: the caller's own role (nullable for anonymous users or
--    profiles that are missing). SECURITY DEFINER so the RLS admin-read
--    policy can use it without recursive policy evaluation.
-- ----------------------------------------------------------------------------
create or replace function public.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ----------------------------------------------------------------------------
-- 2. assign_role: explicit-allowlist role management.
-- ----------------------------------------------------------------------------
create or replace function public.assign_role(target uuid, new_role public.user_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_role public.user_role;
  target_role public.user_role;
begin
  if actor is null then
    raise exception 'not authenticated';
  end if;

  select role into actor_role from public.profiles where id = actor;
  if actor_role is null then
    raise exception 'profile not found';
  end if;

  if target is null or target = actor then
    raise exception 'cannot change your own role';
  end if;

  select role into target_role from public.profiles where id = target;
  if target_role is null then
    raise exception 'target user does not exist';
  end if;

  if target_role = new_role then
    raise exception 'role is unchanged';
  end if;

  -- The Owner is never a normal management target.
  if target_role = 'owner'::public.user_role then
    raise exception 'the owner cannot be modified';
  end if;

  -- 'owner' is never assignable through normal role management.
  if new_role = 'owner'::public.user_role then
    raise exception 'owner role cannot be assigned';
  end if;

  if actor_role = 'owner'::public.user_role then
    -- Owner: manage Contributors and Admins.
    --   student/contributor -> student/contributor/admin
    --   admin              -> student/contributor
    if not (
      (target_role in ('student'::public.user_role, 'contributor'::public.user_role)
         and new_role in ('student'::public.user_role, 'contributor'::public.user_role, 'admin'::public.user_role))
      or (target_role = 'admin'::public.user_role
         and new_role in ('student'::public.user_role, 'contributor'::public.user_role))
    ) then
      raise exception 'transition not allowed';
    end if;
  elsif actor_role = 'admin'::public.user_role then
    -- Admin: student <-> contributor only.
    if not (
      target_role in ('student'::public.user_role, 'contributor'::public.user_role)
      and new_role in ('student'::public.user_role, 'contributor'::public.user_role)
    ) then
      raise exception 'transition not allowed';
    end if;
  else
    raise exception 'insufficient privileges';
  end if;

  update public.profiles set role = new_role where id = target;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. transfer_ownership: the only Owner-mutating operation. Two guarded
--    UPDATEs inside the caller's transaction: demote the current owner, then
--    promote the target. Any failure rolls the whole transaction back.
-- ----------------------------------------------------------------------------
create or replace function public.transfer_ownership(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  affected int;
begin
  if actor is null then
    raise exception 'not authenticated';
  end if;

  if not exists (select 1 from public.profiles where id = actor and role = 'owner'::public.user_role) then
    raise exception 'only the owner can transfer ownership';
  end if;

  if target is null or target = actor then
    raise exception 'cannot transfer ownership to yourself';
  end if;

  if not exists (select 1 from public.profiles where id = target) then
    raise exception 'target user does not exist';
  end if;

  -- Step 1: demote the current owner. Removing the owner row first means the
  -- following promotion can never transiently collide with profiles_one_owner_idx.
  update public.profiles
     set role = 'admin'::public.user_role
   where id = actor;

  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'ownership transfer failed';
  end if;

  -- Step 2: promote the target. The unique index is checked per statement,
  -- so a concurrent transfer either commits first (this aborts) or loses.
  update public.profiles
     set role = 'owner'::public.user_role
   where id = target;

  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'ownership transfer failed';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Single-owner invariant: at most one row may carry role = 'owner'.
--    This is what makes a second concurrent owner impossible to commit.
-- ----------------------------------------------------------------------------
create unique index if not exists profiles_one_owner_idx
  on public.profiles (role)
  where role = 'owner';

-- ----------------------------------------------------------------------------
-- 5. Least-privilege function grants. Role changes are possible ONLY through
--    the two functions; no table-level INSERT/DELETE grants exist.
-- ----------------------------------------------------------------------------
revoke all on function public.current_role() from public;
revoke all on function public.assign_role(uuid, public.user_role) from public;
revoke all on function public.transfer_ownership(uuid) from public;

grant execute on function public.current_role() to authenticated;
grant execute on function public.assign_role(uuid, public.user_role) to authenticated;
grant execute on function public.transfer_ownership(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Admin profile-read policy: admin/owner may list all profiles (member
--    management + user search). Everyone else keeps read-own-only.
-- ----------------------------------------------------------------------------
drop policy if exists "admins can read all profiles" on public.profiles;
create policy "admins can read all profiles"
  on public.profiles
  for select
  to authenticated
  using (public.current_role() in ('admin'::public.user_role, 'owner'::public.user_role));

-- ----------------------------------------------------------------------------
-- 7. Verification queries (read-only, safe to re-run)
-- ----------------------------------------------------------------------------
-- select p.proname, p.prosecdef from pg_proc p where p.proname in ('current_role', 'assign_role', 'transfer_ownership');
-- select tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies where schemaname = 'public';
-- select indexname, indexdef from pg_indexes where tablename = 'profiles';
