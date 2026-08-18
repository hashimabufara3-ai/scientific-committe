-- ============================================================================
-- Fix admin_list_members 42702: column reference "role" is ambiguous
--
-- Root cause:
--   The function returns a table that includes `role public.user_role`, which
--   makes `role` a PL/pgSQL OUT parameter (a local variable) inside the body.
--   The authorization check then executed:
--       select role into actor_role from public.profiles where id = auth.uid();
--   Here `role` is UNQUALIFIED and can be either the OUT-parameter variable
--   `role` or the real column `public.profiles.role`. PostgreSQL 42702
--   rejects the ambiguous reference at plan time, so every call to the RPC
--   fails and the Admin page shows "failed to load members" (Arabic error).
--
-- Fix:
--   Qualify the column references with the table alias `p`. A qualified
--   reference (`p.role`) cannot collide with a PL/pgSQL variable, so the
--   ambiguity is removed. The function signature, returned columns,
--   admin/owner authorization, search behavior and ordering are unchanged.
--
-- This is a NEW migration: the earlier migrations that defined this function
-- are intentionally left untouched.
-- ============================================================================

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
  select p.role into actor_role from public.profiles p where p.id = auth.uid();
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

-- ----------------------------------------------------------------------------
-- Least-privilege grants. create or replace preserves existing grants; these
-- are re-asserted explicitly for consistency with the original migrations.
-- ----------------------------------------------------------------------------
revoke all on function public.admin_list_members(text) from public;
grant execute on function public.admin_list_members(text) to authenticated;

-- ----------------------------------------------------------------------------
-- Verification (read-only, safe to re-run).
-- ----------------------------------------------------------------------------
-- The auth-check line is now qualified; the body should plan without 42702.
--   select id, full_name, username, role, created_at
--     from public.admin_list_members() order by created_at asc;
--   select id, full_name, username, role, created_at
--     from public.admin_list_members('name') order by created_at asc;