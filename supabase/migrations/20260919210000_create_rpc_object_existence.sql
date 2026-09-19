-- ============================================================================
-- Incident #5A — Create-RPC storage-object existence guard.
--
-- PROBLEM (Incident #5 / #5A audit):
--   create_summary(), create_exam() and create_subject_with_summary() are
--   SECURITY DEFINER functions granted to `authenticated`, so a contributor can
--   call them directly through PostgREST with the public anon key + their JWT.
--   Incident #4C added role + forced-password-change + canonical-path
--   enforcement, but the three create RPCs still accept a canonical
--   p_storage_path WITHOUT requiring the backing storage.objects object to
--   exist. An authenticated contributor can therefore mint a DB row such as
--   `summaries/<valid-v4-uuid>.pdf` for an object that does not exist, creating
--   a new dangling resource. The deployed update RPCs (#4D) already close this
--   class of gap using the exact predicate below; this migration extends that
--   contract to the create boundary.
--
-- FIX (this migration only):
--   1. Each create function additionally requires the referenced object to
--      EXIST in the `resources` bucket (storage.objects). The ONLY writer of
--      canonical objects is the server-side finalizeStoredUpload() boundary
--      (service-role), which validates size + magic bytes and moves the object
--      BEFORE any create RPC is called, so canonical + existence == the object
--      was validated and moved by the app.
--   2. Guard placement matches the existing validation blocks (before any
--      INSERT), so a rejected direct call creates ZERO rows — the function's
--      single implicit transaction rolls back.
--
-- REQUIRED BEHAVIOR (unchanged by this migration):
--   * Signatures, parameter order/types, defaults and return types preserved
--     byte-for-byte.
--   * SECURITY DEFINER + `set search_path = public` preserved.
--   * authenticated EXECUTE (NOT service-role-only; anon/service_role grants
--     remain exactly as today — no EXECUTE).
--   * require_contributor() actor derivation + role checks preserved.
--   * must_change_password enforcement preserved.
--   * Canonical-path validation (is_canonical_resource_path) preserved.
--   * Content-mode summaries keep storage_path = NULL (existence check is only
--     fired when source='upload' / p_storage_path is not null).
--   * No magic-byte / MIME / size validation, no upload/move/TUS logic, no
--     storage-object mutation, no subject/author/is_active changes.
--   * Existing rows (incl. the 38 incident-#5 dangling rows) are NOT consulted
--     or mutated — this closes the authoring boundary going forward only.
--
-- NOTE: the storage.objects existence check runs as the owner of the SECURITY
--   DEFINER function (postgres), which can read the storage schema; Storage
--   RLS/grants are untouched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. create_summary — require the referenced object to exist for uploads.
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

  -- Object-existence contract (Incident #5A): an uploaded summary may only be
  -- anchored to an object that already exists in the resources bucket. NULL
  -- paths and content-mode summaries are unaffected. Mirrors the deployed #4D
  -- update_summary() predicate exactly.
  if p_source = 'upload'
     and p_storage_path is not null
     and not exists (
       select 1 from storage.objects
        where bucket_id = 'resources'
          and name = p_storage_path
     ) then
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
-- 2. create_exam — require the referenced object to exist.
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

  -- Object-existence contract (Incident #5A): an exam may only be anchored to
  -- an object that already exists in the resources bucket. Mirrors the
  -- deployed #4D update_exam() predicate exactly.
  if p_storage_path is not null
     and not exists (
       select 1 from storage.objects
        where bucket_id = 'resources'
          and name = p_storage_path
     ) then
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
-- 3. create_subject_with_summary — require summary (upload) and exam objects
--    to exist. NULL/content semantics preserved exactly.
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

  -- Object-existence contract (Incident #5A): an uploaded first summary and an
  -- attached exam must reference objects that already exist in the resources
  -- bucket. NULL/content semantics preserved exactly. Mirrors the deployed
  -- #4D update-function predicates.
  if p_summary_source = 'upload'
     and p_summary_storage_path is not null
     and not exists (
       select 1 from storage.objects
        where bucket_id = 'resources'
          and name = p_summary_storage_path
     ) then
    raise exception 'invalid storage path';
  end if;
  if p_exam_storage_path is not null
     and not exists (
       select 1 from storage.objects
        where bucket_id = 'resources'
          and name = p_exam_storage_path
     ) then
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
-- 4. Grants: keep authenticated EXECUTE (NOT service-role-only). CREATE OR
--    REPLACE preserves grants, but re-assert explicitly. anon/service_role
--    grants are intentionally untouched (neither had EXECUTE before).
-- ----------------------------------------------------------------------------
revoke all on function public.create_summary from public;
revoke all on function public.create_exam from public;
revoke all on function public.create_subject_with_summary from public;

grant execute on function public.create_summary to authenticated;
grant execute on function public.create_exam to authenticated;
grant execute on function public.create_subject_with_summary to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Reconciliation (SELECT-only, non-mutating). Proves the deployed
--    create-side contract contains the storage.objects existence guard on all
--    three functions. Reports via NOTICE; never modifies rows or objects.
-- ----------------------------------------------------------------------------
do $$
declare
  v_guarded boolean;
  v_missing bigint;
  v_bad     bigint;
begin
  select count(*) = 3 into v_guarded
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('create_summary','create_exam','create_subject_with_summary')
     and p.prosecdef
     and p.prosrc like '%storage.objects%'
     and p.prosrc like '%bucket_id = ''resources''%';

  raise notice 'create RPC object-existence guard present on all three functions: %',
    v_guarded;

  select count(*) into v_bad
    from public.summaries
   where source = 'upload'
     and storage_path is not null
     and not public.is_canonical_resource_path(storage_path, 'summary');
  select count(*) into v_missing
    from public.summaries s
   where source = 'upload'
     and storage_path is not null
     and public.is_canonical_resource_path(storage_path, 'summary')
     and not exists (
       select 1 from storage.objects
        where bucket_id = 'resources' and name = s.storage_path
     );

  raise notice 'create-side reconciliation: non-canonical upload paths=%, canonical-but-orphaned rows=% (informational only; existing rows untouched)',
    v_bad, v_missing;
end $$;

-- Manual verification (read-only):
--   select p.proname, p.prosecdef, (p.prosrc like '%storage.objects%') as guarded
--     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname in ('create_summary','create_exam','create_subject_with_summary');
--   select has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
--     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname in ('create_summary','create_exam','create_subject_with_summary');