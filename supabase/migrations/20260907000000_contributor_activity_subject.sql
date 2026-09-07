-- ============================================================================
-- Contributor activity feed — resolve the parent subject name for exam/summary
-- events.
--
-- Background
--   The dashboard's "Recent Activity" wording for exams/summaries must name the
--   subject the resource belongs to (e.g. «شارك امتحان منتصف فصل لمادة
--   «{subject}»»), but contributor_activity only stores the free-text
--   title_en/title_ar (subjects/summaries/edit/delete) or exam_type (exams) —
--   the parent subject of a summary/exam is never captured at write time, so
--   the read function could not resolve its name. This migration adds a
--   nullable subject_id column (the authoritative parent subject) and redefines
--   the two RPC functions to persist and return the parent subject's PUBLIC
--   bilingual title.
--
-- Security model (unchanged; strict subset of what the feed already exposes)
--   * record_contributor_activity() — SECURITY DEFINER — derives subject_id
--     from the AUTHORITATIVE resource row (summaries.subject_id /
--     exam_files.subject_id), never from the client. subject events reference
--     their own id. Ownership/admin/owner gating is untouched.
--   * recent_contributor_activity() — SECURITY DEFINER — LEFT JOINs the public
--     subjects table and returns only subjects.title / subjects.title_ar. These
--     are the same public fields already rendered on the catalog cards; no
--     sensitive data (storage_path, email, profile columns, actor_id) is ever
--     added to the feed.
--   * RLS, table grants, SECURITY DEFINER and require_contributor() stanzas
--     are all preserved exactly.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. contributor_activity.subject_id — nullable parent-subject reference.
--    No NOT NULL constraint: pre-existing rows (recorded before this migration)
--    have no subject and must not be dropped; the UI falls back to a localized
--    generic label in that case. No ON DELETE action: subjects are soft-deleted
--    (is_active = false) and their rows persist, so historical events keep
--    resolving their display name.
-- ----------------------------------------------------------------------------
alter table public.contributor_activity
  add column subject_id uuid;

comment on column public.contributor_activity.subject_id is
  'Parent subject referenced by the event (summaries.subject_id / exam_files.subject_id; subject events reference their own id). NULL for events written before parent-subject tagging; the feed resolves the name via recent_contributor_activity().';

-- The read path joins subjects by this id (created_at desc is already indexed);
-- a secondary index keeps future subject-scoped lookups cheap and bounded.
create index contributor_activity_subject_id_idx
  on public.contributor_activity (subject_id);

-- ----------------------------------------------------------------------------
-- 2. record_contributor_activity — also captures the parent subject id from the
--    authoritative resource row. All existing checks (auth, kind, ownership)
--    are unchanged.
-- ----------------------------------------------------------------------------
create or replace function public.record_contributor_activity(
  p_action text,
  p_kind   text,
  p_id     uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor       uuid;
  v_role        public.user_role;
  v_author      uuid;
  v_title_en    text;
  v_title_ar    text;
  v_exam_type   text;
  v_subject_id  uuid;
begin
  v_actor := public.require_contributor();
  select role into v_role from public.profiles where id = auth.uid();

  if p_action not in ('subject','summary','exam','edit','delete') then
    raise exception 'invalid action';
  end if;
  if p_kind not in ('subject','summary','exam') then
    raise exception 'invalid kind';
  end if;
  -- Creation events must be recorded with the kind that was actually created.
  if p_action in ('subject','summary','exam') and p_action <> p_kind then
    raise exception 'invalid creation kind';
  end if;
  if p_id is null then
    raise exception 'activity requires a resource id';
  end if;

  -- Anchor to the actual resource row so stored title(s) / exam type come from
  -- the authoritative mutation, never from the client. Soft-deleted rows still
  -- exist, so delete events resolve their title from the row being deleted.
  -- The parent subject id is read from the same authoritative row.
  if p_kind = 'subject' then
    select s.title, s.title_ar, s.author_id
      into v_title_en, v_title_ar, v_author
      from public.subjects s where s.id = p_id;
    v_subject_id := p_id;
  elsif p_kind = 'summary' then
    select s.subject_id, s.title, s.title_ar, s.author_id
      into v_subject_id, v_title_en, v_title_ar, v_author
      from public.summaries s where s.id = p_id;
  else
    select e.subject_id, e.type, e.author_id
      into v_subject_id, v_exam_type, v_author
      from public.exam_files e where e.id = p_id;
  end if;

  if v_author is null then
    raise exception 'not found';
  end if;
  -- Ownership mirrored from the mutation RPCs: the acting contributor must be
  -- the author, or an admin/owner moderator.
  if v_author <> v_actor
     and v_role not in ('admin'::public.user_role, 'owner'::public.user_role) then
    raise exception 'not allowed';
  end if;

  insert into public.contributor_activity (actor_id, action, title_en, title_ar, exam_type, subject_id)
  values (
    v_actor,
    p_action,
    case when p_kind = 'exam' then null
         else left(btrim(coalesce(v_title_en, '')), 200) end,
    case when p_kind = 'exam' then null
         else nullif(left(btrim(coalesce(v_title_ar, '')), 200), '') end,
    case when p_kind = 'exam' then v_exam_type else null end,
    v_subject_id
  );
end;
$$;

revoke all on function public.record_contributor_activity(text, text, uuid) from public;
grant execute on function public.record_contributor_activity(text, text, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. recent_contributor_activity — also returns the parent subject's public
--    bilingual title (LEFT JOIN so pre-tagging rows still appear; the subject
--    name may be NULL, in which case the UI falls back to a generic label).
--    subject_name_en/ar come from subjects.title/subjects.title_ar only.
--
--    The RETURNS TABLE gains two columns (subject_name_en/ar), and PostgreSQL
--    rejects CREATE OR REPLACE when the row type of an EXISTING function
--    changes (SQLSTATE 42P13). The function already exists from migration
--    20260906000000, so it is DROPped with its exact signature FIRST and then
--    re-CREATEd with the new row type. The signature stays (integer): the p_limit
--    argument, its OUT parameter shape below and the revoke/grant stanzas are
--    unchanged.
-- ----------------------------------------------------------------------------
drop function public.recent_contributor_activity(integer);

create function public.recent_contributor_activity(p_limit integer default 8)
returns table (
  id               uuid,
  is_own           boolean,
  actor_name_en    text,
  actor_name_ar    text,
  action           text,
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
     order by ca.created_at desc
     limit v_limit;
end;
$$;

revoke all on function public.recent_contributor_activity(integer) from public;
grant execute on function public.recent_contributor_activity(integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Verification queries (read-only, safe to re-run)
-- ----------------------------------------------------------------------------
-- select column_name from information_schema.columns where table_name = 'contributor_activity' order by ordinal_position; -- expect subject_id
-- select id, action, title_en, exam_type, subject_id from public.contributor_activity order by created_at desc limit 8;
-- select * from public.recent_contributor_activity(8);