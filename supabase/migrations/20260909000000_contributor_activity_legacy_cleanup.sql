-- ============================================================================
-- Contributor activity feed — hide LEGACY child events (pre kind/subject_id
-- tagging) that can no longer resolve their parent subject name.
--
-- Background
--   Rows written before migrations 20260907 (subject_id tagging) and
--   20260908 (kind tagging) carry BOTH subject_id = NULL AND kind = NULL. The
--   current read filter keeps every subject_id-NULL row:
--
--       where ca.subject_id is null
--          or s.is_active
--          or ca.kind = 'subject'
--
--   The first branch was fine while those legacy rows were subject-self events
--   (their title_en/title_ar SNAPSHOT the subject name). But legacy summary and
--   exam CREATE events render as "أضاف ملخص {title} إلى مادة {subject}" — they
--   need a LIVE parent subject name. There is none to join (subject_id = NULL),
--   so the UI falls back to «بدون عنوان», which is forbidden.
--
-- Required behavior
--   * The ONLY visible legacy rows whose parent subject can no longer be
--     resolved must be the kind with a self-contained title snapshot: legacy
--     `subject` (create), `delete` and `edit` rows. Their wording renders the
--     snapshotted resource title and never needs a parent subject name.
--   * Legacy `summary` and `exam` CREATE events are hidden at the data source:
--     they cannot satisfy the name invariants (no «بدون عنوان», no parent
--     subject) once the parent subject is gone or unjoinable.
--   * All modern rows (kind populated) keep today's semantics unchanged:
--        - kind = 'subject'            -> always visible (subject create/delete,
--                                          name snapshotted)
--        - subject_id NOT NULL         -> visible iff parent subject is active
--   * The function SIGNATURE and RETURN TYPE are unchanged (this only narrows
--     the WHERE clause), so CREATE OR REPLACE is valid.
--
-- Forward-only
--   * No backfill of legacy rows. The WHERE clause handles them solely by the
--     columns already present (action, kind, subject_id).
--
-- Unchanged
--   * RLS, grants, SECURITY DEFINER, search_path = public,
--     require_contributor() gating, the 8..50 limit clamp, created_at desc
--     ordering, and the 30-day window (client-side).
-- ============================================================================

create or replace function public.recent_contributor_activity(p_limit integer default 8)
returns table (
  id               uuid,
  is_own           boolean,
  actor_name_en    text,
  actor_name_ar    text,
  action           text,
  kind             text,
  title_en         text,
  title_ar         text,
  exam_type        text,
  subject_name_en  text,
  subject_name_ar  text,
  created_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 8), 50));
begin
  perform public.require_contributor();

  return query
    select ca.id,
           (ca.actor_id = auth.uid()) as is_own,
           nullif(btrim(cm.name_en), '') as actor_name_en,
           nullif(btrim(cm.name_ar), '') as actor_name_ar,
           ca.action,
           ca.kind,
           ca.title_en,
           ca.title_ar,
           ca.exam_type,
           nullif(btrim(s.title), '') as subject_name_en,
           nullif(btrim(s.title_ar), '') as subject_name_ar,
           ca.created_at
      from public.contributor_activity ca
      left join public.committee_members cm
        on cm.user_id = ca.actor_id and cm.is_active = true
      left join public.subjects s
        on s.id = ca.subject_id
     where (ca.subject_id is null and ca.kind is null)
             -- Legacy row: no subject reference and no kind. Keep only events
             -- whose wording uses the SNAPSHOTTED resource title (subject
             -- create / delete / edit). Hide legacy summary & exam CREATEs —
             -- they need a live parent subject name that no longer exists.
             and ca.action not in ('summary', 'exam')
        or (ca.subject_id is not null and s.is_active)
             -- Modern row with a parent subject: visible only while that
             -- subject is still active (summary/exam create/edit/delete).
        or ca.kind = 'subject'
             -- Subject-self event (subject create/delete): name is snapshotted,
             -- survives the subject being deactivated or deleted.
     order by ca.created_at desc
     limit v_limit;
end;
$$;

revoke all on function public.recent_contributor_activity(integer) from public;
grant execute on function public.recent_contributor_activity(integer) to authenticated;

-- ----------------------------------------------------------------------------
-- Verification queries (read-only, safe to re-run)
-- ----------------------------------------------------------------------------
-- select p.proname, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid) from pg_proc p where p.proname = 'recent_contributor_activity';
-- select has_function_privilege('public', oid, 'execute'), has_function_privilege('authenticated', oid, 'execute') from pg_proc where proname = 'recent_contributor_activity';
-- -- Expect: legacy summary/exam CREATE rows to drop out; legacy subject/delete/edit and all modern rows to remain.
