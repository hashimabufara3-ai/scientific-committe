-- ============================================================================
-- has_active_resources — maintained subject-visibility flag.
--
-- Phase 9C (Capacity Engineering): implements the design validated in Phase 9B.
--
-- Semantics (exact, unchanged from the app + Phase 8 RPC):
--   visible(subject) <=> subjects.is_active = true
--                       AND (EXISTS active summary OR EXISTS active exam_file)
--
-- has_active_resources represents EXACTLY the parenthesized child-existence
-- predicate (it does NOT fold in subjects.is_active, so it composes with the
-- existing read predicate `is_active AND ...` without touching search or
-- activation semantics). The partial index below therefore serves the RPC's
-- count + page queries directly:
--
--   count/select ... from public.subjects s
--    where s.is_active and s.has_active_resources and [search]
--
-- INSTEAD OF the previous correlated EXISTS-OR-EXISTS probe that ran for every
-- candidate subject (measured ~9.4us per probe into
-- summaries_subject_exam_active_idx; ~10,000 probes at Dataset C scale = the
-- ~98-155ms warm count bottleneck from Phase 9A). Phase 9B measured the same
-- count via the flag at Dataset C: ~8-11ms warm (~12-26x).
--
-- Maintenance: the flag is updated ONLY by AFTER ROW triggers on
-- public.summaries and public.exam_files (INSERT / UPDATE / DELETE), so it can
-- never diverge from the real child state, provided every write to the child
-- tables goes through the database. A subject_id move on a child row
-- re-evaluates BOTH the old and the new parent (the production CRUD functions
-- do not expose moves, but the direct-SQL path stays correct).
--
-- Bulks (bench/migrations) that load child tables row-by-row: the per-row
-- triggers add measured overhead (~0.46ms/insert at lab scale) and a 1M-row
-- single-statement load WITH row triggers exceeds 10 minutes in the lab. The
-- validated protocol for such loads is: DISABLE TRIGGER -> load -> ENABLE
-- TRIGGER -> re-run the RECONCILE block below (or the backfill set-based
-- UPDATE). NOTICE: TRUNCATE does NOT fire row triggers.
--
-- Backfill + reconciliation: the migration computes the flag set-based from
-- the live child tables and then fails loudly if ANY row disagrees with the
-- independent EXISTS-OR-EXISTS truth (target: ZERO mismatches).
--
-- Security model (validated in Phase 9B):
--   - No public/anonymous principal may WRITE subjects/summaries/exam_files
--     (only postgres holds INSERT/UPDATE/DELETE; the app writes exclusively
--     through SECURITY DEFINER CRUD functions, so the AFTER triggers fire as
--     postgres and RLS is not enforced against the update).
--   - The trigger machinery is SECURITY DEFINER with a pinned search_path and
--     no public EXECUTE grant so it runs identically even if a future writer
--     role fires a child-row write; ordinary roles cannot invoke it directly.
--   - The RPC stays SECURITY INVOKER with the existing subjects read policy
--     (is_active = true for anon/authenticated); the new column is not exposed
--     because the RPC selects an explicit column list (never *).
-- Rollback safety: fully reversible with
--   drop trigger if exists summaries_keep_visibility on public.summaries;
--   drop trigger if exists exam_files_keep_visibility on public.exam_files;
--   drop function if exists public.keep_subject_visibility();
--   drop function if exists public.refresh_subject_visibility(uuid);
--   drop index if exists public.subjects_has_active_idx;
--   alter table public.subjects drop column has_active_resources;
--   (the RPC re-creation must be reverted to the Phase-8 body if rolled back)
-- ============================================================================

-- ---- 1. Flag column ---------------------------------------------------------
alter table public.subjects
  add column has_active_resources boolean not null default false;

-- ---- 2. Maintained-flag machinery (Phase 9B-validated implementation) -------

-- 2a. Recompute the flag for a single subject from the live child tables.
--     FOR UPDATE on the subject row serializes concurrent recomputes for the
--     same subject, closing the read-modify-write race under READ COMMITTED.
--     Safe when the subject row is gone (hard-deleted / cascaded): no rows are
--     locked/updated and the function returns without writing.
create or replace function public.refresh_subject_visibility(p_subject_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has boolean;
begin
  if p_subject_id is null then
    return;
  end if;

  perform 1
    from public.subjects
   where id = p_subject_id
     for update;
  if not found then
    return;
  end if;

  select exists (
    select 1
      from public.summaries su
     where su.subject_id = p_subject_id
       and su.is_active = true
    union all
    select 1
      from public.exam_files ef
     where ef.subject_id = p_subject_id
       and ef.is_active = true
  )
  into v_has;

  update public.subjects
     set has_active_resources = v_has
   where id = p_subject_id;
end;
$$;

-- 2b. AFTER trigger kept on BOTH child tables.
--     - INSERT  -> recompute NEW.subject_id
--     - DELETE  -> recompute OLD.subject_id (also fires on FK cascade when a
--                  subject row is hard-deleted; the recompute is a no-op)
--     - UPDATE  -> recompute OLD.subject_id AND NEW.subject_id so a subject_id
--                  move re-evaluates both subjects (direct-SQL path; production
--                  functions do not expose subject_id moves)
create or replace function public.keep_subject_visibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_subject_visibility(old.subject_id);
    return old;
  elsif tg_op = 'UPDATE' then
    perform public.refresh_subject_visibility(old.subject_id);
    perform public.refresh_subject_visibility(new.subject_id);
    return new;
  else -- INSERT
    perform public.refresh_subject_visibility(new.subject_id);
    return new;
  end if;
end;
$$;

-- No public EXECUTE: these are internal plumbing invoked by triggers only.
revoke all on function public.refresh_subject_visibility(uuid) from public;
revoke all on function public.keep_subject_visibility() from public;

create trigger summaries_keep_visibility
  after insert or update or delete on public.summaries
  for each row execute function public.keep_subject_visibility();

create trigger exam_files_keep_visibility
  after insert or update or delete on public.exam_files
  for each row execute function public.keep_subject_visibility();

-- ---- 3. Partial index serving the RPC's count + page queries against the
--         flag (created_at DESC == the RPC ORDER BY). --------------------------
create index subjects_has_active_idx
  on public.subjects (created_at DESC)
  where is_active = true and has_active_resources = true;

-- ---- 4. Backfill: set-based, exact child-existence recompute -----------------
update public.subjects s
   set has_active_resources = exists (
     select 1
       from public.summaries su
      where su.subject_id = s.id
        and su.is_active = true
     union all
     select 1
       from public.exam_files ef
      where ef.subject_id = s.id
        and ef.is_active = true
   );

-- ---- 5. Reconciliation: ZERO mismatches or the migration fails ----------------
do $$
declare
  v_bad bigint;
begin
  select count(*)
    into v_bad
    from public.subjects s
   where s.has_active_resources is distinct from (
     exists (
       select 1
         from public.summaries su
        where su.subject_id = s.id
          and su.is_active = true
       union all
       select 1
         from public.exam_files ef
        where ef.subject_id = s.id
          and ef.is_active = true
     )
   );

  if v_bad > 0 then
    raise exception 'has_active_resources reconciliation failed: % mismatched row(s)', v_bad;
  end if;

  raise notice 'has_active_resources reconciliation: 0 mismatches';
end $$;

-- ============================================================================
-- 6. get_subjects_page — updated predicate.
--
-- Same contract and output shape as the Phase-8 RPC (clamping, exact total,
-- deterministic created_at DESC, id DESC ordering, bilingual LIKE-escaped
-- search, out-of-range clamping, SECURITY INVOKER), with ONE change: the
-- correlated EXISTS-OR-EXISTS visibility probe is replaced by the maintained
-- `has_active_resources` flag so count + page run directly off the partial
-- index above. The flag is server/database-maintained and never exposed to the
-- client (the RPC selects an explicit column list).
-- ============================================================================
create or replace function public.get_subjects_page(
  p_page integer default 1,
  p_page_size integer default 12,
  p_search text default null
)
returns table (
  subjects  jsonb,
  total     bigint,
  totalPages integer,
  page      integer,
  pageSize  integer
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_page_size integer;
  v_page      integer;
  v_search    text;
  v_pattern   text;
  v_where     text;
  v_total     bigint;
  v_pages     integer;
  v_effective integer;
  v_offset    integer;
  v_json      jsonb;
begin
  /* ---- 1. Clamp inputs exactly like the app did ------------------------- */
  v_page_size := greatest(1, least(coalesce(p_page_size, 12), 50));
  v_page      := greatest(1, coalesce(p_page, 1));
  v_search    := nullif(btrim(coalesce(p_search, '')), '');

  /* ---- 2. Build the (shared) WHERE predicate once ----------------------- */
  v_where := 's.is_active and s.has_active_resources';

  if v_search is not null then
    /* Escape LIKE metacharacters exactly like the app's escapeLike():
       \ -> \\ , % -> \%, _ -> \_  so user input is matched literally. The
       pattern is anchored (%...%) to reproduce PostgREST .ilike('%term%'). */
    v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_where := v_where || format(
      ' and (s.title ilike %L or s.title_ar ilike %L)',
      v_pattern, v_pattern
    );
  end if;

  /* ---- 3. Exact total with the SAME predicate --------------------------- */
  execute format('select count(*) from public.subjects s where %s', v_where)
    into v_total;

  /* totalPages: 0 visible rows -> 1 page (matches app empty behavior). */
  v_pages := case when v_total > 0 then ceil(v_total::numeric / v_page_size)::int else 1 end;

  /* Out-of-range page clamps to the last valid page (matches app). */
  v_effective := least(v_page, v_pages);
  v_offset    := (v_effective - 1) * v_page_size;

  /* ---- 4. One page, deterministic order, same predicate ------------------ */
  execute format(
    'select coalesce(jsonb_agg(z), ''[]''::jsonb) from (
       select s.id, s.title, s.title_ar, s.category, s.author_id,
              s.created_at, s.updated_at
         from public.subjects s
        where %s
        order by s.created_at desc, s.id desc
        limit %s offset %s
     ) z',
    v_where, v_page_size, v_offset
  ) into v_json;

  return query select v_json, v_total, v_pages, v_effective, v_page_size;
end;
$$;

/* ---- 7. Least-privilege grants ----------------------------------------- */
revoke all on function public.get_subjects_page(integer, integer, text) from public;
grant execute on function public.get_subjects_page(integer, integer, text) to anon, authenticated;

-- Verification (read-only, safe to re-run):
-- select * from public.get_subjects_page(1, 12, null);
-- select * from public.get_subjects_page(1, 12, 'math''%');