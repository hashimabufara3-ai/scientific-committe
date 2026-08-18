-- ============================================================================
-- Committee Members: positional display order (no duplicate sort_order values)
--
-- Problem:
--   admin_update_committee_member used to overwrite sort_order directly, so
--   moving a member from 6 to 7 left two members at 7 and a gap at 6.
--
-- Fix:
--   sort_order is now treated as a 1-based POSITION in a single ordered list
--   of ALL committee members (active and inactive — the same sequence the
--   admin list displays; the public carousel is the active-only subsequence).
--   Moving a member to position P removes it from the list and re-inserts it
--   at P, shifting the members in between by exactly one slot. Positions are
--   always renumbered back to a dense permutation of 1..N, so duplicates and
--   gaps can never persist.
--
-- Safety:
--   * Identical function signatures -> existing grants, RPC callers and the
--     hand-maintained database-types.ts keep working unchanged.
--   * Each function runs in one transaction (RPC semantics); a transaction
--     advisory lock serializes concurrent reorders so two admins cannot
--     interleave shifts into an inconsistent state.
--   * Only rows whose position actually changes are written (no spurious
--     updated_at churn; moving to the current position is a no-op).
--   * Step 1 renumbers EXISTING rows once, healing any duplicates/gaps that
--     were created before this fix. No member or field data is discarded.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. One-time repair: renumber existing rows to a dense 1..N permutation.
--    Tie-breaks (created_at, id) keep the current visible order deterministic.
-- ----------------------------------------------------------------------------
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
-- 2. admin_create_committee_member: insert AT a position, shifting others down
--    p_sort_order is the desired 1-based position; clamped to [1, N+1]
--    (N+1 = append at the end). 0 (the UI default) clamps to 1, preserving
--    the existing "new member appears first" behavior.
-- ----------------------------------------------------------------------------
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

  select count(*) into v_count from public.committee_members;
  v_target := greatest(1, least(p_sort_order, v_count + 1));

  -- Serialize concurrent reorders for the rest of this transaction.
  perform pg_advisory_xact_lock(hashtext('committee_members_order'));

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

-- ----------------------------------------------------------------------------
-- 3. admin_update_committee_member: move to a position, shifting others
--    p_sort_order is the desired 1-based position; clamped to [1, N].
--    The member is removed from the ordered list and re-inserted at the
--    target; members in between shift by exactly one slot. Moving to the
--    current position renumbers to the same permutation = no writes.
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

  if not exists (select 1 from public.committee_members where id = p_id) then
    raise exception 'committee member not found';
  end if;

  select count(*) into v_count from public.committee_members;
  v_target := greatest(1, least(p_sort_order, v_count));

  -- Serialize concurrent reorders for the rest of this transaction.
  perform pg_advisory_xact_lock(hashtext('committee_members_order'));

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

  -- Reorder: remove p_id from the list, re-insert at v_target, renumber.
  -- seq is the position among the OTHER members (1..N-1); members before the
  -- insertion point keep their slot, members at/after it shift down by one.
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
-- 4. Re-assert least-privilege grants (create or replace preserves them since
--    the signatures are unchanged; repeated here to be explicit/idempotent).
-- ----------------------------------------------------------------------------
revoke all on function public.admin_create_committee_member(
  text,text,text,text,text,text,text,integer,boolean,uuid
) from public;
revoke all on function public.admin_update_committee_member(
  uuid,text,text,text,text,text,text,text,integer,boolean,uuid
) from public;

grant execute on function public.admin_create_committee_member(
  text,text,text,text,text,text,text,integer,boolean,uuid
) to authenticated;
grant execute on function public.admin_update_committee_member(
  uuid,text,text,text,text,text,text,text,integer,boolean,uuid
) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Verification queries (read-only, safe to re-run)
-- ----------------------------------------------------------------------------
-- Expect no duplicates and no gaps after any create/update:
--   select sort_order, count(*)
--     from public.committee_members
--    group by sort_order
--   having count(*) > 1;                                   -- expect 0 rows
--   select sort_order from public.committee_members
--    order by sort_order;                                  -- expect 1..N dense
