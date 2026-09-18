-- ============================================================================
-- get_subjects_page — DB-side visibility + pagination for the catalog page.
--
-- Phase 8 (Capacity Engineering): moves the pagination decision OUT of the
-- application layer and INTO PostgreSQL.
--
-- Problem remediated (VERIFIED in Phase 7):
--   The old getSubjectsPage() fetched the FULL matching active subject set
--   (no LIMIT), then resolved visibility by fetching EVERY active child row of
--   every matching subject (2x ~500k-row scans at Dataset C), derived the
--   visible-id set in Node.js, and applied JS slice() pagination.
--
-- This function instead:
--   1. Clamps page/pageSize (page >= 1; 1 <= pageSize <= 50).
--   2. Applies the visibility predicate in SQL: an active subject is visible
--      when it has >=1 active summary OR >=1 active exam_file (EXISTS OR
--      EXISTS) — exactly the app's current visibleRows semantics.
--   3. Applies the same bilingual search semantics (title ILIKE %term% OR
--      title_ar ILIKE %term%), INCLUDING the LIKE escaping that the app's
--      escapeLike() applies and the PostgREST .or() grammar-hazard path that
--      previously ran two separate .ilike() queries — a single bound parameter
--      has no PostgREST grammar, so both paths converge to one identical
--      SQL predicate below.
--   4. Computes the exact total (COUNT) with the SAME WHERE clause via a
--      single dynamic WHERE string — the count predicate and the page
--      predicate are guaranteed to match by construction.
--   5. Returns exactly one page (LIMIT v_page_size OFFSET ...) ordered
--      deterministically (created_at DESC, id DESC), clamping out-of-range
--      pages to the last valid page (totalPages >= 1, so totalPages is 1 for
--      an empty catalog, matching the app's empty-result behavior).
--
-- Security: SECURITY INVOKER (NOT SECURITY DEFINER). The function runs with
-- the CALLER's privileges, so the existing RLS policies apply to every read
-- inside it (public can only read is_active = true rows). It performs no
-- writes. Execute is granted only to the same principals who may read the
-- tables (anon, authenticated) and revoked from public. No auth, RLS,
-- authorization or rate-limit model is changed.
--
-- Rollback safety: this is a pure addition (CREATE OR REPLACE FUNCTION + two
-- GRANT statements). It is fully reversible with DROP FUNCTION
-- public.get_subjects_page(integer, integer, text). No production data is
-- modified; no existing function is replaced.
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
  v_where := '
    s.is_active
      and (
        exists (
          select 1 from public.summaries su
          where su.subject_id = s.id and su.is_active
        )
        or exists (
          select 1 from public.exam_files ef
          where ef.subject_id = s.id and ef.is_active
        )
      )';

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

/* ---- 5. Least-privilege grants ----------------------------------------- */
revoke all on function public.get_subjects_page(integer, integer, text) from public;
grant execute on function public.get_subjects_page(integer, integer, text) to anon, authenticated;

-- Verification (read-only, safe to re-run):
-- select * from public.get_subjects_page(1, 12, null);
-- select * from public.get_subjects_page(2, 12, null);
-- select * from public.get_subjects_page(1, 12, 'math''%');