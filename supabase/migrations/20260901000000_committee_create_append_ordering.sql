-- ============================================================================
-- Committee Members: append new members to the END of the display order
-- ============================================================================
-- Purpose:
--   sort_order is a 1-based POSITION in a single ordered list of ALL committee
--   members (active and inactive). Previously, admin_create_committee_member
--   clamped the requested position to [1, N+1] and mapped the 0 (UI default)
--   sentinel to position 1, so a newly added member appeared FIRST.
--
--   This migration re-authors ONLY admin_create_committee_member so that a
--   newly added member is ALWAYS appended at the LAST position (N + 1). The
--   create-time placement no longer consults p_sort_order; reordering is done
--   exclusively through admin_update_committee_member, preserving the existing
--   deterministic ordering model (sort_order asc, created_at asc, id asc) and
--   the advisory lock.
--
-- SECURITY (preserved unchanged):
--   * require_admin() call, field validation, and user_id profile check are
--     identical to the currently-applied function.
--   * SECURITY DEFINER, search_path = public, signature (including the
--     p_sort_order parameter, kept so the application's named RPC call and
--     lib/auth/database-types.ts are unaffected) and grants are unchanged.
--   * CREATE OR REPLACE preserves existing grants and ownership.
--   * No RLS, auth, rate-limiting, delete, or update functions are touched.
-- ============================================================================

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
begin
  perform public.require_admin();

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

  -- Serialize concurrent reorders BEFORE counting rows so the read snapshot
  -- and the writes are consistent (same lock key used by update/delete).
  perform pg_advisory_xact_lock(hashtext('committee_members_order'));

  select count(*) into v_count from public.committee_members;
  -- A newly added member is ALWAYS appended at the last position (N + 1).
  v_target := v_count + 1;

  -- Renumber existing members to a dense 1..N permutation using the same
  -- deterministic ordering (sort_order asc, created_at asc, id asc) that
  -- update/delete use. Because the new member is always appended at the end,
  -- this is effectively a no-op for an already-dense sequence, but it keeps
  -- the ordering-renumbering model consistent and defensive for all cases.
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

-- Least-privilege grants (re-asserted for explicitness; CREATE OR REPLACE
-- preserves them in any case).
revoke all on function public.admin_create_committee_member(
  text, text, text, text, text, text, text, integer, boolean, uuid
) from public;
grant execute on function public.admin_create_committee_member(
  text, text, text, text, text, text, text, integer, boolean, uuid
) to authenticated;

-- ----------------------------------------------------------------------------
-- Verification queries (read-only, safe to re-run)
-- ----------------------------------------------------------------------------
-- New body present (appends at the end):
--   select position('v_count + 1' in pg_get_functiondef(p.oid)) > 0 as appends_at_end,
--          position('p_sort_order' in pg_get_functiondef(p.oid)) > 0 as keeps_param,
--          position('pg_advisory_xact_lock' in pg_get_functiondef(p.oid)) > 0 as has_lock
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname = 'admin_create_committee_member'
--      and pg_get_function_identity_arguments(p.oid) =
--          'text, text, text, text, text, text, text, integer, boolean, uuid';
-- ============================================================================
