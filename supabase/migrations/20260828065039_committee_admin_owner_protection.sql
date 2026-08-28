-- ============================================================================
-- Committee Admin vs Owner protection + profile privacy restoration
-- ============================================================================
-- Purpose (approved requirements):
--   * owner: full control over every committee member and profile flag.
--   * admin: may add / update / remove committee members linked to NULL,
--     student, or contributor accounts; may NOT modify or remove a
--     committee_members record linked to an owner or another admin; may NOT
--     link a committee member to an owner/admin account; may NOT set
--     must_change_password = true on an owner or another admin profile.
--
-- What this migration does:
--   1. Drops the 3 MANUAL committee_members DML policies (INSERT/UPDATE/DELETE)
--      that bypass the SECURITY DEFINER functions and let an admin modify or
--      delete owner/admin-linked records. The application never uses direct
--      DML on committee_members (all writes go through the admin_* functions),
--      so these policies are unused by the app and are the requirement-2 hole.
--   2. Drops "admins can read all profiles" on profiles. The admin member
--      listing is served by admin_list_members() (which returns no email);
--      this broad policy leaked every profile's email/username and
--      must_change_password to all admins/owners.
--   3. Adds require_admin_role() -- unchanged semantics vs require_admin() but
--      also RETURNS the acting role so caller functions can distinguish an
--      admin (restricted) from an owner (full). require_admin() itself is NOT
--      modified and remains for existing callers.
--   4. Hardens the 5 SECURITY DEFINER functions below. Every existing
--      signature, validation and ordering behavior is preserved verbatim; only
--      an actor-role capture and target/link role guards are added.
--
-- STATUS: APPLIED. This migration has been applied to the production database.
-- It is kept here as the authoritative record of the production schema state.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Drop the 3 manual committee_members DML policies (bypass / hole).
-- ----------------------------------------------------------------------------
drop policy if exists "admins and owner can insert committee members" on public.committee_members;
drop policy if exists "admins and owner can update committee members" on public.committee_members;
drop policy if exists "admins and owner can delete committee members" on public.committee_members;

-- ----------------------------------------------------------------------------
-- 2. Drop the broad admin profile-read policy (privacy leak).
--    Admin/owner member listing stays available via admin_list_members(),
--    which returns id/full_name/username/role/created_at and NEVER email.
-- ----------------------------------------------------------------------------
drop policy if exists "admins can read all profiles" on public.profiles;

-- ----------------------------------------------------------------------------
-- 3. helper: require_admin_role()
--    Identical authorization to require_admin() (admin or owner, from
--    auth.uid()) but returns the acting role so caller functions can enforce
--    the admin-vs-owner distinction. require_admin() is left untouched.
-- ----------------------------------------------------------------------------
create or replace function public.require_admin_role()
returns public.user_role
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role public.user_role;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select role into actor_role from public.profiles where id = auth.uid();
  if actor_role is null
     or actor_role not in ('admin'::public.user_role, 'owner'::public.user_role) then
    raise exception 'insufficient privileges';
  end if;

  return actor_role;
end;
$$;

revoke all on function public.require_admin_role() from public;
grant execute on function public.require_admin_role() to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Hardened SECURITY DEFINER functions
--    (signatures unchanged; require_admin() replaced by require_admin_role()
--     + target/link role guards only. All other validation/ordering intact.)
-- ----------------------------------------------------------------------------

-- 4a. admin_create_committee_member: an admin may not link a new member to an
--     owner/admin account.
create or replace function public.admin_create_committee_member(
  p_name_ar    text,
  p_name_en    text,
  p_major_ar   text,
  p_major_en   text,
  p_role_ar    text,
  p_role_en    text,
  p_gender     text,
  p_sort_order integer default 0,
  p_is_active  boolean default true,
  p_user_id    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id   uuid;
  v_count  integer;
  v_target integer;
  v_actor  public.user_role;
  v_trole  public.user_role;
begin
  v_actor := public.require_admin_role();

  -- Validate required fields
  if btrim(p_name_ar) = '' then raise exception 'name_ar is required'; end if;
  if btrim(p_name_en) = '' then raise exception 'name_en is required'; end if;
  if btrim(p_major_ar) = '' then raise exception 'major_ar is required'; end if;
  if btrim(p_major_en) = '' then raise exception 'major_en is required'; end if;
  if btrim(p_role_ar) = '' then raise exception 'role_ar is required'; end if;
  if btrim(p_role_en) = '' then raise exception 'role_en is required'; end if;
  if p_gender not in ('male', 'female') then raise exception 'gender must be male or female'; end if;

  -- Validate user_id references an existing profile
  if p_user_id is not null and not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user_id does not reference an existing user';
  end if;

  -- An admin may not link a committee member to an owner or admin account.
  if p_user_id is not null and v_actor = 'admin'::public.user_role then
    select role into v_trole from public.profiles where id = p_user_id;
    if v_trole in ('admin'::public.user_role, 'owner'::public.user_role) then
      raise exception 'admin cannot link a committee member to an owner or admin account';
    end if;
  end if;

  -- Serialize concurrent reorders BEFORE counting rows or computing the
  -- target position.
  perform pg_advisory_xact_lock(hashtext('committee_members_order'));

  select count(*) into v_count from public.committee_members;
  -- Clamp the requested position to the valid range [1, N+1].
  v_target := greatest(1, least(p_sort_order, v_count + 1));

  -- Renumber existing members: everyone at/after the insertion point moves
  -- down by one slot, leaving position v_target free.
  with others as (
    select cm.id,
           row_number() over (
             order by cm.sort_order asc, cm.created_at asc, cm.id asc
           ) as seq
      from public.committee_members cm
  ),
  placed as (
    select id,
           case when seq < v_target then seq else seq + 1 end as new_pos
      from others
  )
  update public.committee_members cm
     set sort_order = p.new_pos
    from placed p
   where cm.id = p.id
     and cm.sort_order <> p.new_pos;

  insert into public.committee_members
    (user_id, name_ar, name_en, major_ar, major_en, role_ar, role_en, gender, sort_order, is_active)
  values
    (p_user_id, btrim(p_name_ar), btrim(p_name_en), btrim(p_major_ar), btrim(p_major_en),
     btrim(p_role_ar), btrim(p_role_en), p_gender, v_target, p_is_active)
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.admin_create_committee_member(
  text,text,text,text,text,text,text,integer,boolean,uuid
) from public;
grant execute on function public.admin_create_committee_member(
  text,text,text,text,text,text,text,integer,boolean,uuid
) to authenticated;

-- ----------------------------------------------------------------------------
-- 4b. admin_update_committee_member: an admin may not modify a member linked
--     to an owner/admin account, nor re-link this member to an owner/admin.
-- ----------------------------------------------------------------------------
create or replace function public.admin_update_committee_member(
  p_id         uuid,
  p_name_ar    text,
  p_name_en    text,
  p_major_ar   text,
  p_major_en   text,
  p_role_ar    text,
  p_role_en    text,
  p_gender     text,
  p_sort_order integer,
  p_is_active  boolean,
  p_user_id    uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count  integer;
  v_target integer;
  v_actor  public.user_role;
  v_trole  public.user_role;
begin
  v_actor := public.require_admin_role();

  -- Validate required fields
  if btrim(p_name_ar) = '' then raise exception 'name_ar is required'; end if;
  if btrim(p_name_en) = '' then raise exception 'name_en is required'; end if;
  if btrim(p_major_ar) = '' then raise exception 'major_ar is required'; end if;
  if btrim(p_major_en) = '' then raise exception 'major_en is required'; end if;
  if btrim(p_role_ar) = '' then raise exception 'role_ar is required'; end if;
  if btrim(p_role_en) = '' then raise exception 'role_en is required'; end if;
  if p_gender not in ('male', 'female') then raise exception 'gender must be male or female'; end if;

  -- Validate user_id references an existing profile (or is null to unlink)
  if p_user_id is not null and not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user_id does not reference an existing user';
  end if;

  if not exists (select 1 from public.committee_members where id = p_id) then
    raise exception 'committee member not found';
  end if;

  -- An admin may not modify a committee member linked to an owner or admin.
  select p.role into v_trole
    from public.committee_members cm
    left join public.profiles p on p.id = cm.user_id
   where cm.id = p_id;
  if v_actor = 'admin'::public.user_role
     and v_trole in ('admin'::public.user_role, 'owner'::public.user_role) then
    raise exception 'admin cannot modify or remove an owner or admin committee member';
  end if;

  -- An admin may not re-link this member to an owner or admin account.
  if p_user_id is not null and v_actor = 'admin'::public.user_role then
    select role into v_trole from public.profiles where id = p_user_id;
    if v_trole in ('admin'::public.user_role, 'owner'::public.user_role) then
      raise exception 'admin cannot link a committee member to an owner or admin account';
    end if;
  end if;

  -- Serialize concurrent reorders BEFORE counting rows or computing the
  -- target position, so the read snapshot and the writes are consistent.
  perform pg_advisory_xact_lock(hashtext('committee_members_order'));

  select count(*) into v_count from public.committee_members;
  -- Clamp the requested position to the valid range [1, N].
  v_target := greatest(1, least(p_sort_order, v_count));

  -- Non-order fields (sort_order is handled exclusively by the reorder below)
  update public.committee_members
     set user_id    = p_user_id,
         name_ar    = btrim(p_name_ar),
         name_en    = btrim(p_name_en),
         major_ar   = btrim(p_major_ar),
         major_en   = btrim(p_major_en),
         role_ar    = btrim(p_role_ar),
         role_en    = btrim(p_role_en),
         gender     = p_gender,
         is_active  = p_is_active
   where id = p_id;

  -- Reorder: remove p_id from the list, re-insert at v_target, and renumber
  -- everyone as a dense 1..N permutation.
  with others as (
    select cm.id,
           row_number() over (
             order by cm.sort_order asc, cm.created_at asc, cm.id asc
           ) as seq
      from public.committee_members cm
     where cm.id <> p_id
  ),
  placed as (
    select id,
           case when seq < v_target then seq else seq + 1 end as new_pos
      from others
  ),
  final as (
    select id, new_pos from placed
    union all
    select p_id, v_target
  )
  update public.committee_members cm
     set sort_order = f.new_pos
    from final f
   where cm.id = f.id
     and cm.sort_order <> f.new_pos;
end;
$$;

revoke all on function public.admin_update_committee_member(
  uuid,text,text,text,text,text,text,text,integer,boolean,uuid
) from public;
grant execute on function public.admin_update_committee_member(
  uuid,text,text,text,text,text,text,text,integer,boolean,uuid
) to authenticated;

-- ----------------------------------------------------------------------------
-- 4c. admin_delete_committee_member: an admin may not delete a member linked
--     to an owner or admin account.
-- ----------------------------------------------------------------------------
create or replace function public.admin_delete_committee_member(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.user_role;
  v_trole public.user_role;
begin
  v_actor := public.require_admin_role();

  select p.role into v_trole
    from public.committee_members cm
    left join public.profiles p on p.id = cm.user_id
   where cm.id = p_id;

  if v_actor = 'admin'::public.user_role
     and v_trole in ('admin'::public.user_role, 'owner'::public.user_role) then
    raise exception 'admin cannot modify or remove an owner or admin committee member';
  end if;

  delete from public.committee_members where id = p_id;

  if not found then
    raise exception 'committee member not found';
  end if;
end;
$$;

revoke all on function public.admin_delete_committee_member(uuid) from public;
grant execute on function public.admin_delete_committee_member(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4d. admin_create_committee_member_private: an admin may not add private data
--     for a member linked to an owner or admin account.
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
declare
  v_actor public.user_role;
  v_trole public.user_role;
begin
  v_actor := public.require_admin_role();

  if not exists (
    select 1 from public.committee_members where id = p_committee_member_id
  ) then
    raise exception 'committee member not found';
  end if;

  select p.role into v_trole
    from public.committee_members cm
    left join public.profiles p on p.id = cm.user_id
   where cm.id = p_committee_member_id;

  if v_actor = 'admin'::public.user_role
     and v_trole in ('admin'::public.user_role, 'owner'::public.user_role) then
    raise exception 'admin cannot modify an owner or admin committee member';
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
-- 4e. set_must_change_password: an admin may not force a password change on an
--     owner or another admin profile. Owner retains full control.
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
declare
  v_actor public.user_role;
  v_trole public.user_role;
begin
  v_actor := public.require_admin_role();

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user not found';
  end if;

  if v_actor = 'admin'::public.user_role then
    select role into v_trole from public.profiles where id = p_user_id;
    if v_trole in ('admin'::public.user_role, 'owner'::public.user_role) then
      raise exception 'admin cannot set must_change_password on an owner or admin profile';
    end if;
  end if;

  update public.profiles
     set must_change_password = p_must_change
   where id = p_user_id;
end;
$$;

revoke all on function public.set_must_change_password(uuid, boolean) from public;
grant execute on function public.set_must_change_password(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- Verification queries (read-only, safe to re-run)
-- ----------------------------------------------------------------------------
-- Policies: expect NO committee_members INSERT/UPDATE/DELETE policies and NO
--   "admins can read all profiles" on profiles.
--   select tablename, policyname, cmd from pg_policies
--    where schemaname = 'public'
--    order by tablename, cmd;
--
-- Exactly one function per name/signature, new bodies have 'require_admin_role':
--   select p.proname, pg_get_function_identity_arguments(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('require_admin_role','admin_create_committee_member',
--                        'admin_update_committee_member','admin_delete_committee_member',
--                        'admin_create_committee_member_private','set_must_change_password')
--    order by p.proname;
