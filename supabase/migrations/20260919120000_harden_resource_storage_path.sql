-- ============================================================================
-- Incident #4C — Storage path hardening for resource-creation RPCs.
--
-- PROBLEM (Incident #4 / #4B):
--   create_summary(), create_exam() and create_subject_with_summary() are
--   SECURITY DEFINER functions granted to `authenticated`, so a contributor can
--   call them directly through PostgREST with the public anon key + their JWT.
--   They accepted a caller-supplied p_storage_path verbatim, which bypassed the
--   application's finalizeStoredUpload() boundary (canonical path, existence,
--   size, magic bytes) and could store arbitrary/quarantine/nonexistent paths.
--   They also did not enforce the forced-password-change flag.
--
-- FIX (this migration only):
--   1. A single SQL canonical-path validator, equivalent to the shared
--      lib/content/file-format.mjs `isCanonicalResourcePath()`, is used by all
--      three functions. Valid resource paths are EXACTLY:
--          summaries/<uuid-v4>.(pdf|jpg|png|webp|gif)
--          exams/<uuid-v4>.(pdf|jpg|png|webp|gif)
--      Anything else (NULL, empty, leading slash, quarantine/*, other prefix,
--      `..`/encoded traversal, extra segments, wrong extension, non-v4 UUID) is
--      REJECTED — never normalized/repaired.
--   2. The three functions now reject callers whose profile has
--      must_change_password = true (read from public.profiles by auth.uid(),
--      never from client input).
--
-- PRESERVED:
--   * SECURITY DEFINER + `set search_path = public`;
--   * authenticated EXECUTE (NOT service-role-only);
--   * actor derivation via public.require_contributor() -> auth.uid();
--   * author_id is always the derived actor (never caller-supplied);
--   * existing subject/source/type validation;
--   * no storage-object-existence, size or magic-byte checks are added to SQL
--     (those stay in the application finalization boundary).
--
-- NOTE: update_summary()/update_exam() also accept p_storage_path and are
--   granted to authenticated. They are OUT OF SCOPE for this incident and
--   remain a known follow-up (see incident report).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Canonical path validator (SQL equivalent of isCanonicalResourcePath).
--    IMMUTABLE, deterministic, no storage access. Internal plumbing: no
--    PUBLIC EXECUTE.
-- ----------------------------------------------------------------------------
create or replace function public.is_canonical_resource_path(
  p_path text,
  p_kind text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_path is null or p_path = '' then false
    when p_kind = 'summary' then
      p_path ~* '^summaries/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|jpg|png|webp|gif)$'
    when p_kind = 'exam' then
      p_path ~* '^exams/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|jpg|png|webp|gif)$'
    else
      p_path ~* '^(summaries|exams)/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|jpg|png|webp|gif)$'
  end;
$$;

revoke all on function public.is_canonical_resource_path(text, text) from public;

-- ----------------------------------------------------------------------------
-- 2. create_summary — forced-password-change guard + canonical path (summary).
-- ----------------------------------------------------------------------------
create or replace function public.create_summary(
  p_subject_id   uuid,
  p_title        text,
  p_title_ar     text default null,
  p_description  text default null,
  p_description_ar text default null,
  p_source       text default 'content',
  p_content      text default null,
  p_videos       text[] default '{}',
  p_storage_path text default null,
  p_file_name    text default null,
  p_mime_type    text default null,
  p_file_size    bigint default null,
  p_file_url     text default null,
  p_file_size_label text default null,
  p_pages        integer default null,
  p_external_resources jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_subj  uuid;
  v_id    uuid;
begin
  v_actor := public.require_contributor();

  -- Forced password change blocks resource mutation (mirrors the app layer).
  if coalesce(
       (select must_change_password from public.profiles where id = v_actor),
       false
     ) then
    raise exception 'must change password';
  end if;

  if p_title is null or trim(p_title) = '' then
    raise exception 'title is required';
  end if;

  if p_source not in ('upload','content') then
    raise exception 'invalid source';
  end if;

  -- Parent must exist AND still be active, so a deleted subject can never
  -- accept new public content (stale/malicious client cannot orphan rows).
  select id into v_subj from public.subjects
   where id = p_subject_id and is_active = true;
  if v_subj is null then
    raise exception 'subject not found';
  end if;

  if p_source = 'upload' and (p_storage_path is null or p_file_name is null) then
    raise exception 'upload requires storage_path and file_name';
  end if;

  -- Canonical storage path only. Reject arbitrary/quarantine/traversal paths
  -- instead of storing them verbatim (never normalize into a valid path).
  if p_storage_path is not null
     and not public.is_canonical_resource_path(p_storage_path, 'summary') then
    raise exception 'invalid storage path';
  end if;

  insert into public.summaries (
    subject_id, title, title_ar, description, description_ar,
    source, content, videos, storage_path, file_name, mime_type, file_size,
    file_url, file_size_label, pages, external_resources, author_id
  ) values (
    p_subject_id, trim(p_title), p_title_ar, p_description, p_description_ar,
    p_source, p_content, coalesce(p_videos, '{}'::text[]), p_storage_path, p_file_name,
    p_mime_type, p_file_size, p_file_url, p_file_size_label, p_pages,
    coalesce(p_external_resources, '[]'::jsonb), v_actor
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. create_exam — forced-password-change guard + canonical path (exam).
-- ----------------------------------------------------------------------------
create or replace function public.create_exam(
  p_subject_id   uuid,
  p_type         text,
  p_storage_path text,
  p_file_name    text,
  p_year         text default null,
  p_semester     text default null,
  p_mime_type    text default null,
  p_file_size    bigint default null,
  p_file_url     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_subj  uuid;
  v_id    uuid;
begin
  v_actor := public.require_contributor();

  -- Forced password change blocks resource mutation (mirrors the app layer).
  if coalesce(
       (select must_change_password from public.profiles where id = v_actor),
       false
     ) then
    raise exception 'must change password';
  end if;

  if p_type not in ('midterm','final') then
    raise exception 'invalid exam type';
  end if;

  -- Parent must exist AND still be active (prevents orphaned public content).
  select id into v_subj from public.subjects
   where id = p_subject_id and is_active = true;
  if v_subj is null then
    raise exception 'subject not found';
  end if;

  if p_storage_path is null or p_file_name is null then
    raise exception 'exam requires storage_path and file_name';
  end if;

  -- Canonical storage path only (never normalize into a valid path).
  if not public.is_canonical_resource_path(p_storage_path, 'exam') then
    raise exception 'invalid storage path';
  end if;

  insert into public.exam_files (
    subject_id, type, year, semester, storage_path, file_name, mime_type,
    file_size, file_url, author_id
  ) values (
    p_subject_id, p_type, p_year, p_semester, p_storage_path, p_file_name,
    p_mime_type, p_file_size, p_file_url, v_actor
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. create_subject_with_summary — forced-password-change guard + canonical
--    paths for both the first summary and the optional exam.
-- ----------------------------------------------------------------------------
create or replace function public.create_subject_with_summary(
  p_title                text,
  p_summary_title        text,
  p_title_ar             text default null,
  p_category             text default null,
  p_summary_title_ar     text default null,
  p_summary_description  text default null,
  p_summary_description_ar text default null,
  p_summary_source       text default 'content',
  p_summary_content      text default null,
  p_summary_videos       text[] default '{}',
  p_summary_storage_path text default null,
  p_summary_file_name    text default null,
  p_summary_mime_type    text default null,
  p_summary_file_size    bigint default null,
  p_exam_type            text default null,
  p_exam_year            text default null,
  p_exam_semester        text default null,
  p_exam_storage_path    text default null,
  p_exam_file_name       text default null,
  p_exam_mime_type       text default null,
  p_exam_file_size       bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid;
  v_subject uuid;
begin
  v_actor := public.require_contributor();

  -- Forced password change blocks resource mutation (mirrors the app layer).
  if coalesce(
       (select must_change_password from public.profiles where id = v_actor),
       false
     ) then
    raise exception 'must change password';
  end if;

  if p_title is null or trim(p_title) = '' then
    raise exception 'title is required';
  end if;
  if p_summary_title is null or trim(p_summary_title) = '' then
    raise exception 'title is required';
  end if;
  if p_summary_source not in ('upload', 'content') then
    raise exception 'invalid source';
  end if;
  if p_summary_source = 'upload'
     and (p_summary_storage_path is null or p_summary_file_name is null) then
    raise exception 'upload requires storage_path and file_name';
  end if;
  if p_exam_type is not null then
    if p_exam_type not in ('midterm', 'final') then
      raise exception 'invalid exam type';
    end if;
    if p_exam_storage_path is null or p_exam_file_name is null then
      raise exception 'exam requires storage_path and file_name';
    end if;
  end if;

  -- Canonical storage paths only (never normalize into a valid path).
  if p_summary_storage_path is not null
     and not public.is_canonical_resource_path(p_summary_storage_path, 'summary') then
    raise exception 'invalid storage path';
  end if;
  if p_exam_storage_path is not null
     and not public.is_canonical_resource_path(p_exam_storage_path, 'exam') then
    raise exception 'invalid storage path';
  end if;

  insert into public.subjects (title, title_ar, category, author_id)
  values (trim(p_title), p_title_ar, p_category, v_actor)
  returning id into v_subject;

  insert into public.summaries (
    subject_id, title, title_ar, description, description_ar, source, content,
    videos, storage_path, file_name, mime_type, file_size, author_id
  ) values (
    v_subject, trim(p_summary_title), p_summary_title_ar, p_summary_description,
    p_summary_description_ar, p_summary_source, p_summary_content,
    coalesce(p_summary_videos, '{}'::text[]), p_summary_storage_path,
    p_summary_file_name, p_summary_mime_type, p_summary_file_size, v_actor
  );

  if p_exam_type is not null then
    insert into public.exam_files (
      subject_id, type, year, semester, storage_path, file_name, mime_type,
      file_size, author_id
    ) values (
      v_subject, p_exam_type, p_exam_year, p_exam_semester, p_exam_storage_path,
      p_exam_file_name, p_exam_mime_type, p_exam_file_size, v_actor
    );
  end if;

  return v_subject;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Grants: keep authenticated EXECUTE (NOT service-role-only). CREATE OR
--    REPLACE preserves grants, but re-assert explicitly.
-- ----------------------------------------------------------------------------
revoke all on function public.create_summary from public;
revoke all on function public.create_exam from public;
revoke all on function public.create_subject_with_summary from public;

grant execute on function public.create_summary to authenticated;
grant execute on function public.create_exam to authenticated;
grant execute on function public.create_subject_with_summary to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Reconciliation (SELECT-only, non-mutating). Expected on current hosted
--    data: 30/30 summaries valid, 10/10 exams valid, 0 non-canonical.
--    Reports via NOTICE; never modifies rows.
-- ----------------------------------------------------------------------------
do $$
declare
  v_bad_summaries bigint;
  v_bad_exams     bigint;
begin
  select count(*) into v_bad_summaries
    from public.summaries
   where source = 'upload'
     and not public.is_canonical_resource_path(storage_path, 'summary');

  select count(*) into v_bad_exams
    from public.exam_files
   where not public.is_canonical_resource_path(storage_path, 'exam');

  raise notice 'resource storage_path reconciliation: summaries invalid=%, exams invalid=%',
    v_bad_summaries, v_bad_exams;
end $$;

-- Manual verification (read-only):
--   select id, storage_path from public.summaries
--    where source = 'upload'
--      and not public.is_canonical_resource_path(storage_path, 'summary');
--   select id, storage_path from public.exam_files
--    where not public.is_canonical_resource_path(storage_path, 'exam');
