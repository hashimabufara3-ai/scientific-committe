-- ============================================================================
-- Committee Members: renumber display order (sort_order) after deletion
-- ============================================================================
-- Purpose:
--   sort_order is a 1-based POSITION in a single ordered list of ALL committee
--   members (active and inactive). The positional model requires a dense 1..N
--   sequence with no gaps (see 20260817090002 / 20260828065039 section 4b).
--   create and update already renumber to a dense permutation; DELETE did not,
--   so deleting a member left a gap (e.g. 1, 2, 3, 4 minus #2 -> 1, 3, 4).
--
-- This migration re-authors ONLY admin_delete_committee_member(uuid) so that,
-- after a successful delete, the remaining members are renumbered to a dense
-- 1..N permutation. The ordering-renumber logic mirrors the exact strategy
-- already used by admin_create_committee_member and
-- admin_update_committee_member (pg_advisory_xact_lock on
-- 'committee_members_order' + row_number() over (sort_order, created_at, id)).
--
-- SECURITY (preserved unchanged):
--   * require_admin_role() call and admin-vs-owner target protection are
--     identical to the currently-applied function.
--   * "committee member not found" behavior is preserved.
--   * SECURITY DEFINER, search_path = public, signature and grants are
--     unchanged. CREATE OR REPLACE keeps existing grants and ownership intact.
--   * No RLS, auth, rate-limiting, or other functions are touched.
-- ============================================================================

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

  -- Serialize concurrent deletes/reorders so the read snapshot and the
  -- writes are consistent (same lock key used by create/update).
  perform pg_advisory_xact_lock(hashtext('committee_members_order'));

  delete from public.committee_members
   where id = p_id;

  if not found then
    raise exception 'committee member not found';
  end if;

  -- Renumber the survivors to a dense 1..N permutation using the same
  -- deterministic ordering (sort_order asc, created_at asc, id asc) that
  -- create/update use. Only rows whose position actually changes are
  -- written; a failure rolls back the whole delete + renumber.
  with renumbered as (
    select
      cm.id,
      row_number() over (
        order by cm.sort_order asc, cm.created_at asc, cm.id asc
      ) as new_pos
    from public.committee_members cm
  )
  update public.committee_members cm
     set sort_order = r.new_pos
    from renumbered r
   where cm.id = r.id
     and cm.sort_order <> r.new_pos;
end;
$$;

-- Least-privilege grants (re-asserted for explicitness; CREATE OR REPLACE
-- preserves them in any case).
revoke all on function public.admin_delete_committee_member(uuid) from public;
grant execute on function public.admin_delete_committee_member(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Verification queries (read-only, safe to re-run)
-- ----------------------------------------------------------------------------
-- No duplicates, dense 1..N:
--   select sort_order, count(*) from public.committee_members
--    group by sort_order having count(*) > 1;              -- expect 0 rows
--   select sort_order from public.committee_members
--    order by sort_order;                                  -- expect 1..N
--
-- New body present (admin-vs-owner guard and renumber both exist):
--   select position('require_admin_role' in pg_get_functiondef(p.oid)) > 0 as has_guard,
--          position('renumbered' in pg_get_functiondef(p.oid)) > 0 as has_renumber,
--          position('pg_advisory_xact_lock' in pg_get_functiondef(p.oid)) > 0 as has_lock,
--          position('committee_members_order' in pg_get_functiondef(p.oid)) > 0 as has_lock_key
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname = 'admin_delete_committee_member'
--      and pg_get_function_identity_arguments(p.oid) = 'uuid';
-- ============================================================================
