-- ============================================================================
-- Contributor activity feed — record the resource kind and hide child events of
-- a soft-deleted subject at the DATA SOURCE (the read RPC), keeping the
-- "subject deleted" event visible with the subject's real name.
--
-- Required behavior
--   * Deleting a subject must NOT hide that deletion event: it stays visible
--     with the subject's real bilingual name, which is SNAPSHOTTED into
--     title_en/title_ar when the event is recorded — never «بدون عنوان» and
--     never a raw id, and independent of any future subjects row.
--   * Any event deriving from a deleted subject — summary/exam create, edit or
--     delete, and any other subject_id-bound event — must disappear from the
--     feed once the parent subject is no longer active. Enforced in
--     recent_contributor_activity() below, so every consumer sees the same
--     filtered feed (not a React-only filter).
--   * Subject creation events keep showing (they name the subject itself and
--     carry the name snapshot), matching the existing 30-day window / 8-item
--     behavior, which are unchanged.
--
-- Forward-only
--   * Adds a nullable `kind` column populated ONLY on new writes. No backfill:
--     the resource kind of legacy edit/delete rows is not knowable and must
--     never be guessed. Legacy rows keep today's behavior (visible while their
--     subject is active; hidden once it is deactivated).
--   * Absent kind rows are treated as child events for the filtering decision,
--     but the ONLY event allowed to survive a deleted subject is the explicit
--     kind = 'subject' row (subject creation AND subject deletion).
--
-- Unchanged
--   * RLS, zero table grants, SECURITY DEFINER, security definer search_path
--     = public, require_contributor() gating, the ownership/admin/owner checks
--     in record_contributor_activity (all validation bytes preserved), the
--     8..50 limit clamp, created_at desc ordering, the 30-day window (client-
--     side), and all existing function grants/signatures.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. contributor_activity.kind — the resource kind the event refers to, written
--    at record time so the feed can distinguish a subject-self event (whose
--    name is snapshotted) from child events (whose subject must still be live).
--    NULL solely for rows written before this migration (no backfill).
-- ----------------------------------------------------------------------------
alter table public.contributor_activity
  add column kind text check (kind in ('subject', 'summary', 'exam'));

comment on column public.contributor_activity.kind is
  'Resource kind the event refers to (subject/summary/exam), recorded at write time. NULL for legacy rows; the read RPC keeps subject-self events (kind ''subject'') visible after the subject is deleted and hides other rows when their subject is no longer active.';

-- ----------------------------------------------------------------------------
-- 2. record_contributor_activity — same signature (text, text, uuid) and
--    returns void; the ONLY change is persisting `kind` = p_kind alongside the
--    authoritative-derivation of title(s), exam_type and subject_id. Every
--    existing check (actor gate, action/kind whitelists, creation-kind
--    match, resource anchor, ownership/admin/owner) is preserved byte-for-byte.
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
  -- exist, so a subject deletion event resolves its display name (title_en /
  -- title_ar) from the row being deactivated and snapshots it — the deletion
  -- event never depends on a later subjects row.
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

  insert into public.contributor_activity (actor_id, action, kind, title_en, title_ar, exam_type, subject_id)
  values (
    v_actor,
    p_action,
    p_kind,
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
-- 3. recent_contributor_activity — the ONLY read path. RETURNS TABLE gains the
--    `kind` column (same argument signature (integer), same SECURITY DEFINER /
--    require_contributor() model, same public-safe fields) AND now filters at
--    the data source:
--
--      rows stay visible when
--        * they carry no subject reference (written before subject tagging), or
--        * their parent subject is still active, or
--        * they are subject-self events (kind = 'subject') — subject creation
--          and subject deletion. Their stored title_en/title_ar snapshot the
--          subject name, so they render correctly even after the subject is
--          deactivated (row not required to exist).
--
--      rows are hidden otherwise — every summary/exam-derived event whose
--      parent subject is no longer active (or no longer exists).
--
--    The row type changes (added `kind`), so PostgreSQL forbids CREATE
--    OR REPLACE (SQLSTATE 42P13) and the existing function must be dropped
--    first with its exact signature.
-- ----------------------------------------------------------------------------
drop function public.recent_contributor_activity(integer);

create function public.recent_contributor_activity(p_limit integer default 8)
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
     where ca.subject_id is null
        or s.is_active
        or ca.kind = 'subject'
     order by ca.created_at desc
     limit v_limit;
end;
$$;

revoke all on function public.recent_contributor_activity(integer) from public;
grant execute on function public.recent_contributor_activity(integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Verification queries (read-only, safe to re-run)
-- ----------------------------------------------------------------------------
-- select column_name from information_schema.columns where table_name = 'contributor_activity' order by ordinal_position; -- now includes kind
-- select p.proname, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid) from pg_proc p where p.proname in ('record_contributor_activity','recent_contributor_activity');
-- select has_function_privilege('public', oid, 'execute'), has_function_privilege('authenticated', oid, 'execute') from pg_proc where proname in ('record_contributor_activity','recent_contributor_activity');
-- select tablename, rowsecurity from pg_tables where schemaname='public' and tablename='contributor_activity';