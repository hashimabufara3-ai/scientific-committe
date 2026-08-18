-- ============================================================================
-- Committee Members: positional display order — guaranteed function replace
--
-- LIVE-DB FINDING (verified via pg_get_functiondef on the live database):
--   The live public.admin_update_committee_member still performs a direct
--   sort_order overwrite (no pg_advisory_xact_lock, no v_target/v_count,
--   no others-CTE). Exactly one such function exists and it is the OLD body,
--   so the previous migration never took effect on the live database.
--
-- This migration therefore uses an explicit DROP of the exact existing
-- signature before CREATE, so there can never be an accidental overload and
-- the replacement is guaranteed to take effect regardless of what is live.
--
-- Model:
--   sort_order is a 1-based POSITION in a single ordered list of ALL
--   committee members (active and inactive — the same sequence the admin
--   list displays; the public carousel is the active-only subsequence).
--   Moving a member to position P removes it from the list and re-inserts
--   it at P; members in between shift by exactly one slot. Positions are
--   always renumbered back to a dense permutation of 1..N, so duplicates
--   and gaps can never persist.
--
-- Safety:
--   * Parameter names/order/types are identical to the original functions
--     (matching app/[lang]/admin/actions.ts named RPC args and
--     lib/auth/database-types.ts) — no overload is created.
--   * pg_advisory_xact_lock is taken BEFORE counting rows or computing the
--     target position, serializing concurrent reorders; each function runs
--     in a single transaction, so a failure rolls back the whole reorder.
--   * Only rows whose position actually changes are written (moving to the
--     current position is a no-op).
--   * Step 1 renumbers EXISTING rows once, repairing duplicates/gaps created
--     before this fix. No member or field data is deleted or lost.
--   * Grants are re-asserted after DROP+CREATE (DROP removes them).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. One-time repair: renumber existing rows to a deterministic dense 1..N
--    permutation using the established ordering rule
--    (sort_order asc, created_at asc, id asc as final tie-break).
--    The advisory lock serializes this repair with any in-flight reorder.
-- ----------------------------------------------------------------------------
select pg_advisory_xact_lock(hashtext('committee_members_order'));

with ordered as (
  select cm.id,
         row_number() over (
           order by cm.sort_order asc, cm.created_at asc, cm.id asc
         ) as pos
    from public.committee_members cm
)
update public.committee_members cm
   set sort_order = o.pos
  from ordered o
 where cm.id = o.id
   and cm.sort_order <> o.pos;

-- ----------------------------------------------------------------------------
-- 2. admin_update_committee_member: move to a position, shifting others
--    Exact existing signature:
--      (uuid, text, text, text, text, text, text, text, integer, boolean, uuid)
--    Parameter names preserved for named RPC calls from the application.
-- ----------------------------------------------------------------------------
drop function if exists public.admin_update_committee_member(
  uuid, text, text, text, text, text, text, text, integer, boolean, uuid
);

create function public.admin_update_committee_member(
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

  -- Validate user_id references an existing profile (or is null to unlink)
  if p_user_id is not null and not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user_id does not reference an existing user';
  end if;

  -- Validate the target member exists
  if not exists (select 1 from public.committee_members where id = p_id) then
    raise exception 'committee member not found';
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

  -- Reorder: remove p_id from the ordered list, re-insert at v_target, and
  -- renumber everyone as a dense 1..N permutation.
  --   seq is the position among the OTHER members (1..N-1):
  --     * seq <  v_target -> keeps its slot (unaffected side)
  --     * seq >= v_target -> shifts down by one (makes room at v_target)
  --   Moving downward shifts the in-between members UP by one slot;
  --   moving upward shifts them DOWN by one slot.
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

-- ----------------------------------------------------------------------------
-- 3. admin_create_committee_member: insert AT a position, shifting others down
--    Exact existing signature:
--      (text, text, text, text, text, text, text, integer, boolean, uuid)
--    p_sort_order is the desired 1-based position; clamped to [1, N+1]
--    (N+1 = append at the end). 0 (the UI default) clamps to 1, preserving
--    the existing "new member appears first" behavior.
-- ----------------------------------------------------------------------------
drop function if exists public.admin_create_committee_member(
  text, text, text, text, text, text, text, integer, boolean, uuid
);

create function public.admin_create_committee_member(
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

  -- Serialize concurrent reorders BEFORE counting rows or computing the
  -- target position.
  perform pg_advisory_xact_lock(hashtext('committee_members_order'));

  select count(*) into v_count from public.committee_members;
  -- Clamp the requested position to the valid range [1, N+1].
  v_target := greatest(1, least(p_sort_order, v_count + 1));

  -- Renumber existing members: everyone at/after the insertion point moves
  -- down by one slot, leaving position v_target free for the new member.
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

-- ----------------------------------------------------------------------------
-- 4. Least-privilege grants (re-asserted: DROP removed them)
-- ----------------------------------------------------------------------------
revoke all on function public.admin_update_committee_member(
  uuid, text, text, text, text, text, text, text, integer, boolean, uuid
) from public;
revoke all on function public.admin_create_committee_member(
  text, text, text, text, text, text, text, integer, boolean, uuid
) from public;

grant execute on function public.admin_update_committee_member(
  uuid, text, text, text, text, text, text, text, integer, boolean, uuid
) to authenticated;
grant execute on function public.admin_create_committee_member(
  text, text, text, text, text, text, text, integer, boolean, uuid
) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Verification queries (read-only, safe to re-run)
-- ----------------------------------------------------------------------------
-- Exactly one function per name/signature:
--   select p.proname, pg_get_function_identity_arguments(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('admin_update_committee_member',
--                        'admin_create_committee_member');
--
-- New body is live (all true):
--   select position('pg_advisory_xact_lock' in pg_get_functiondef(p.oid)) > 0,
--          position('v_target' in pg_get_functiondef(p.oid)) > 0,
--          position('others' in pg_get_functiondef(p.oid)) > 0
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname = 'admin_update_committee_member';
--
-- No duplicates, dense 1..N:
--   select sort_order, count(*) from public.committee_members
--    group by sort_order having count(*) > 1;              -- expect 0 rows
--   select sort_order from public.committee_members
--    order by sort_order;                                  -- expect 1..N
