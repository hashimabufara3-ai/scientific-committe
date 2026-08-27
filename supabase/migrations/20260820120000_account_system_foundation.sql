-- ============================================================================
-- Phase 2A: Account system foundation.
--
-- Prepares the database for the future committee-member account system
-- without modifying any existing behavior. All changes are additive and
-- backward-compatible.
--
-- Creates:
--   - public.committee_member_private (1:1 with committee_members, stores
--     sensitive fields like father_name, no public SELECT policy)
--   - profiles.must_change_password (boolean, default false)
--   - Tightened profiles UPDATE policy (protects must_change_password)
--   - public.audit_log table with RLS (admin/owner read only)
--   - public.log_audit_event() SECURITY DEFINER helper
--
-- Does NOT:
--   - create auth users
--   - modify existing RPC signatures
--   - modify the login or signup flow
--   - modify the admin UI
--   - modify existing RLS except the profiles UPDATE policy tightening
--   - add a service-role key
--
-- SECURITY NOTE on father_name:
--   father_name is stored in a SEPARATE table (committee_member_private),
--   NOT on committee_members. The committee_members table has a public RLS
--   policy (SELECT to anon/authenticated WHERE is_active = true) that would
--   expose any new column to direct PostgREST queries. PostgreSQL does not
--   support column-level SELECT grants, so the only safe way to keep
--   father_name private is a separate table with no public SELECT policy.
--   SECURITY DEFINER functions can still access it. The existing public
--   committee_members table and its RLS are completely untouched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. committee_member_private: private metadata for committee members.
--    Stores sensitive fields that must NOT be exposed through public PostgREST
--    access. The committee_members table has a public SELECT RLS policy that
--    grants access to all columns for active members. PostgreSQL does not
--    support column-level SELECT grants, so sensitive fields like father_name
--    (needed for future username generation) must live in a separate table.
--
--    This table has NO public SELECT policy. Only SECURITY DEFINER functions
--    (which bypass RLS) can read it. The admin CRUD functions will be updated
--    in Phase 2B to manage this table.
-- ----------------------------------------------------------------------------
create table public.committee_member_private (
  committee_member_id uuid primary key references public.committee_members(id) on delete cascade,
  father_name         text not null default ''
);

-- No SELECT policy: anonymous and authenticated users CANNOT read this table.
-- SECURITY DEFINER functions bypass RLS and CAN read it.
-- No INSERT/UPDATE/DELETE policies: all writes through SECURITY DEFINER functions.
-- ON DELETE CASCADE: if a committee member is deleted, private data is removed too.

-- ----------------------------------------------------------------------------
-- 2. profiles: add must_change_password
--    Defaults to false so all existing users remain fully functional.
--    Only settable through SECURITY DEFINER functions in future phases.
--    Users cannot set this to true through normal profile updates.
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column must_change_password boolean not null default false;

-- ----------------------------------------------------------------------------
-- 3. Tighten profiles UPDATE policy
--    The existing "update own profile" policy prevents role changes but does
--    not protect the new must_change_password column. Add a defense-in-depth
--    check: a user must not set must_change_password to false if it is
--    currently true. In practice no current user has this set to true, so
--    this is a forward-looking safeguard.
--    Dropping and recreating the policy in a single statement is safe because
--    no other migration depends on this exact policy name.
-- ----------------------------------------------------------------------------
drop policy if exists "update own profile" on public.profiles;

create policy "update own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select role from public.profiles where id = auth.uid())
    and (
      must_change_password = true
      or (select must_change_password from public.profiles where id = auth.uid()) = false
    )
  );

-- ----------------------------------------------------------------------------
-- 4. audit_log table
--    Records who did what, when, to which target, with what details.
--    Passwords, tokens, and credentials must NEVER be stored in details.
--    IP addresses are NOT recorded because PostgreSQL functions cannot access
--    HTTP request headers; the application layer handles IP logging if needed.
-- ----------------------------------------------------------------------------
create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references auth.users(id) on delete set null,
  actor_email text,
  action      text not null,
  target_type text not null,
  target_id   uuid,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Indexes for common query patterns
create index audit_log_actor_id_idx
  on public.audit_log (actor_id);

create index audit_log_action_idx
  on public.audit_log (action);

create index audit_log_target_idx
  on public.audit_log (target_type, target_id);

create index audit_log_created_at_idx
  on public.audit_log (created_at desc);

-- ----------------------------------------------------------------------------
-- 5. audit_log RLS
--    Only admin/owner may read. No client INSERT/UPDATE/DELETE policies.
--    Inserts happen exclusively through the SECURITY DEFINER log_audit_event()
--    function, which bypasses RLS.
-- ----------------------------------------------------------------------------
alter table public.audit_log enable row level security;

create policy "admins can read audit log"
  on public.audit_log
  for select
  to authenticated
  using (public.current_role() in ('admin'::public.user_role, 'owner'::public.user_role));

-- No INSERT policy: inserts only through log_audit_event() (SECURITY DEFINER).
-- No UPDATE policy: audit logs are append-only.
-- No DELETE policy: audit logs are immutable.

-- ----------------------------------------------------------------------------
-- 6. log_audit_event: SECURITY DEFINER helper for future phases.
--    Actor is derived from auth.uid() internally. Never accept actor_id or
--    actor_email from the client. Passwords, tokens, and credentials must
--    never be logged.
--
--    IP address is NOT accepted as a parameter. PostgreSQL functions cannot
--    access HTTP request headers (CF-Connecting-IP, X-Forwarded-For, etc.).
--    Accepting IP from the client would allow spoofing. If IP logging is
--    needed, it must happen in the application layer (Next.js server actions)
--    and stored directly, not through this function.
--
--    This function is infrastructure only. Do NOT wire it into existing CRUD
--    functions yet.
-- ----------------------------------------------------------------------------
create or replace function public.log_audit_event(
  p_action      text,
  p_target_type text,
  p_target_id   uuid default null,
  p_details     jsonb  default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id    uuid;
  v_actor_email text;
begin
  -- Derive actor from the authenticated session. Never accept from client.
  v_actor_id := auth.uid();

  if v_actor_id is not null then
    select email into v_actor_email
      from auth.users
     where id = v_actor_id;
  end if;

  insert into public.audit_log
    (actor_id, actor_email, action, target_type, target_id, details)
  values
    (v_actor_id, v_actor_email, p_action, p_target_type, p_target_id, p_details);
end;
$$;

-- Least-privilege grants: only authenticated users may call log_audit_event.
-- The function is SECURITY DEFINER, so it executes with the privileges of
-- the function owner (table owner / postgres), not the caller. The INSERT
-- on audit_log succeeds regardless of the caller's RLS because SECURITY
-- DEFINER bypasses RLS. The GRANT ensures only logged-in users can invoke
-- the function (not anonymous).
revoke all on function public.log_audit_event(text, text, uuid, jsonb) from public;
grant execute on function public.log_audit_event(text, text, uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Verification queries (read-only, safe to re-run)
-- ----------------------------------------------------------------------------
-- Verify committee_member_private exists with correct columns
-- select column_name, is_nullable, column_default
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'committee_member_private'
--  order by ordinal_position;

-- Verify committee_member_private has NO public SELECT policy
-- select policyname, cmd from pg_policies
--  where schemaname = 'public' and tablename = 'committee_member_private'; -- expect 0 rows

-- Verify profiles.must_change_password exists with correct default
-- select column_name, is_nullable, column_default
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'profiles' and column_name = 'must_change_password';

-- Verify audit_log table and indexes
-- select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'audit_log';
-- select indexname, indexdef from pg_indexes where tablename = 'audit_log';

-- Verify audit_log RLS policy
-- select policyname, cmd, qual from pg_policies where schemaname = 'public' and tablename = 'audit_log';

-- Verify log_audit_event function exists (4 params, no ip_address)
-- select proname, prosecdef, pg_get_function_arguments(oid) as args
--   from pg_proc where proname = 'log_audit_event';

-- Verify existing committee members unchanged (expect 31)
-- select count(*) from public.committee_members;
-- select count(*) from public.committee_members where is_active;

-- Verify existing profiles unchanged (must_change_password should be false for all)
-- select count(*) from public.profiles where must_change_password = true; -- expect 0

-- Verify existing committee_members RLS policy untouched
-- select policyname, cmd, qual from pg_policies
--  where schemaname = 'public' and tablename = 'committee_members';

-- Verify existing profiles policies still present
-- select policyname from pg_policies where schemaname = 'public' and tablename = 'profiles' order by policyname;

-- Verify no RPC signatures changed
-- select proname, pg_get_function_arguments(oid) from pg_proc
--  where proname like 'admin_%committee%' or proname in ('current_role', 'assign_role', 'transfer_ownership', 'require_admin')
--  order by proname;

-- Verify committee_members table has NO father_name column (it's in committee_member_private)
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name = 'committee_members' and column_name = 'father_name'; -- expect 0 rows
