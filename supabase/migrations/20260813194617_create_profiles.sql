-- ============================================================================
-- Phase 2: Public profiles foundation for authentication
-- Run in the Supabase Dashboard SQL Editor (or via Supabase CLI db push).
--
-- Creates:
--   - public.user_role enum (student, admin)
--   - public.profiles table (1:1 with auth.users, ON DELETE CASCADE)
--   - automatic profile creation trigger on auth.users
--   - updated_at trigger
--   - Row Level Security + least-privilege policies
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Role enum
-- ----------------------------------------------------------------------------
create type public.user_role as enum ('student', 'admin');

-- ----------------------------------------------------------------------------
-- 2. Profiles table
-- ----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  role public.user_role not null default 'student',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. Least-privilege grants
--    Client roles (anon/authenticated) never get INSERT/DELETE at the grant
--    layer either. Row creation happens only through the SECURITY DEFINER
--    trigger below, which runs as the table owner (postgres).
-- ----------------------------------------------------------------------------
revoke all on table public.profiles from anon, authenticated;
grant select, update on table public.profiles to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Row Level Security
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;

-- 4a. Users can read only their own profile.
create policy "read own profile"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

-- 4b. Users can update their own profile, but the role must stay identical to
--     the existing row. Comparing the NEW role to the CURRENT stored role
--     prevents self-promotion to 'admin' (or any other role change) through
--     client updates. Admin promotion will be done via a trusted process in a
--     later phase.
create policy "update own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select role from public.profiles where id = auth.uid())
  );

-- No INSERT policy: users cannot create profile rows, including for others.
-- No DELETE policy: users cannot delete any profile, including their own.

-- ----------------------------------------------------------------------------
-- 5. Automatic profile creation
--    SECURITY DEFINER is required here: the insert fires from the auth schema
--    after auth.users row creation, and must succeed regardless of the
--    authenticated/anon role grants and RLS. It runs as the table owner.
--    search_path is pinned to 'public' to prevent search-path hijacking.
--    Only the new user's id and (optionally) the full_name they provided at
--    signup are used. Role is never taken from client metadata.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 6. updated_at maintenance
--    SECURITY INVOKER (default): safe, no privilege change.
-- ----------------------------------------------------------------------------
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

-- ----------------------------------------------------------------------------
-- 7. Verification queries (safe to re-run; read-only)
-- ----------------------------------------------------------------------------
-- select table_name, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'profiles';
-- select * from pg_policies where schemaname = 'public' and tablename = 'profiles';
-- select proname, prosecdef from pg_proc where proname in ('handle_new_user', 'handle_updated_at');
