-- ============================================================================
-- Contributor workflow consistency fixes (verified problems):
--
-- 1. PREMATURE PUBLIC VISIBILITY ON CREATE
--    A new material used to be created as THREE independent Server Actions
--    (create_subject -> upload summary -> create_summary -> upload exam ->
--    create_exam). The active subject row committed BEFORE the rest of the flow
--    finished, so the public (force-dynamic) catalog displayed an incomplete
--    subject for several seconds (measured +1.6s / +5.3s / +10.2s).
--
--    create_subject_with_summary() inserts the subject, its first summary and
--    an optional previous exam inside ONE SECURITY DEFINER function — a single
--    Postgres transaction committed atomically. A concurrent reader (the
--    public page) can never observe the subject before the summary (and exam)
--    exist, because the row publishes only at commit. A failure rolls back the
--    whole transaction -> there is NO publicly visible incomplete subject.
--
-- 2. DELETE ~5s LATENCY
--    delete_subject_action previously issued THREE sequential round trips (two
--    admin storage-path SELECTs + the delete RPC) then removed Storage objects.
--    delete_subject_with_storage() returns the child storage paths and performs
--    the authoritative soft delete in ONE call, so the action makes a single
--    round trip. Storage cleanup stays best-effort and AFTER the DB delete.
--
-- 3. ORPHANED PUBLIC CHILDREN UNDER DELETED SUBJECTS
--    create_summary() / create_exam() only verified the parent row EXISTS, so
--    content could be silently attached to a soft-deleted subject through a
--    stale client catalog. Both now require the parent to be ACTIVE
--    (is_active = true), preventing NEW orphaned public content. Historical
--    rows are not touched.
--
-- All functions are additive or behavior-preserving for valid flows; the
-- existing soft-delete model and authorization (require_contributor +
-- ownership checks) are unchanged.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Atomic creation of a new material (subject + first summary + optional exam)
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

revoke all on function public.create_subject_with_summary from public;
grant execute on function public.create_subject_with_summary to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Delete a subject and return its child storage paths in one round trip.
--    Authoritative soft delete + path collection happen inside the function
--    (SECURITY DEFINER), so RLS never hides the paths.
-- ----------------------------------------------------------------------------
create or replace function public.delete_subject_with_storage(p_id uuid)
returns table (storage_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_role  public.user_role;
  v_owned boolean;
begin
  v_actor := public.require_contributor();
  select role into v_role from public.profiles where id = auth.uid();

  select (author_id = v_actor) into v_owned
    from public.subjects where id = p_id;
  if v_owned is null then
    raise exception 'not found';
  end if;
  if not v_owned
     and v_role not in ('admin'::public.user_role, 'owner'::public.user_role) then
    raise exception 'not allowed';
  end if;

  /* Storage paths of child files are collected while they are fully visible
     inside the same function, then the subject is soft-deleted. */
  return query
    select s.storage_path from public.summaries s
     where s.subject_id = p_id and s.storage_path is not null;
  return query
    select e.storage_path from public.exam_files e
     where e.subject_id = p_id and e.storage_path is not null;

  update public.subjects set is_active = false where id = p_id;
end;
$$;

revoke all on function public.delete_subject_with_storage from public;
grant execute on function public.delete_subject_with_storage to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Require an ACTIVE parent for summaries / exams (prevent orphaned content).
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
  if p_type not in ('midterm','final') then
    raise exception 'invalid exam type';
  end if;

  -- Parent must exist AND still be active, so a deleted subject can never
  -- accept new public content (stale/malicious client cannot orphan rows).
  select id into v_subj from public.subjects
   where id = p_subject_id and is_active = true;
  if v_subj is null then
    raise exception 'subject not found';
  end if;

  if p_storage_path is null or p_file_name is null then
    raise exception 'exam requires storage_path and file_name';
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