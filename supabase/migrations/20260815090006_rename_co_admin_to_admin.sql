-- ============================================================================
-- Rename co_admin -> admin in the user_role enum + fix all dependent functions.
--
-- This migration must run BEFORE the committee_members migration, which
-- references 'admin'::public.user_role.
--
-- On a fresh database where the enum was created with 'admin' (migrations
-- 20260815090001+), this migration is a no-op.
--
-- On the live database where the enum currently has 'co_admin', this migration:
--   1. Renames the enum value
--   2. Re-creates every function/policy that references the old value
-- ============================================================================

-- Step 1: Rename the enum value.
do $$
begin
  alter type public.user_role rename value 'co_admin' to 'admin';
  raise notice 'Renamed enum value co_admin -> admin';
exception
  when duplicate_object then
    raise notice 'Enum value already "admin" — skipping rename';
end $$;

-- Step 2: Re-create assign_role() with 'admin' instead of 'co_admin'.
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

  if target_role = 'owner'::public.user_role then
    raise exception 'the owner cannot be modified';
  end if;

  if new_role = 'owner'::public.user_role then
    raise exception 'owner role cannot be assigned';
  end if;

  if actor_role = 'owner'::public.user_role then
    -- Owner: manage Contributors and Admins.
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

-- Step 3: Re-create transfer_ownership() — demotes owner to 'admin'.
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

  update public.profiles
     set role = 'admin'::public.user_role
   where id = actor;

  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'ownership transfer failed';
  end if;

  update public.profiles
     set role = 'owner'::public.user_role
   where id = target;

  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'ownership transfer failed';
  end if;
end;
$$;

-- Step 4: Re-create admin profile-read policy.
drop policy if exists "admins can read all profiles" on public.profiles;
create policy "admins can read all profiles"
  on public.profiles
  for select
  to authenticated
  using (public.current_role() in ('admin'::public.user_role, 'owner'::public.user_role));

-- Step 5: Re-create admin_list_members() with username and 'admin' auth check.
create or replace function public.admin_list_members(search text default null)
returns table (
  id uuid,
  full_name text,
  username text,
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
      select p.id, p.full_name, p.username, p.role, p.created_at
        from public.profiles p
       order by p.created_at asc;
  else
    return query
      select p.id, p.full_name, p.username, p.role, p.created_at
        from public.profiles p
       where position(lower(search) in lower(p.full_name)) > 0
          or position(lower(search) in lower(p.username)) > 0
       order by p.created_at asc;
  end if;
end;
$$;

-- Step 6: Verification (read-only, safe to re-run).
-- select enum_range(null::public.user_role);
-- select role, count(*) from public.profiles group by role;
-- select p.proname, p.prosecdef from pg_proc p where p.proname in ('assign_role', 'transfer_ownership', 'admin_list_members');
