-- ============================================================================
-- Incident #4D — Update-RPC storage-path integrity hardening.
--
-- PROBLEM (Incident #4 / #4B continuation):
--   update_summary() and update_exam() are SECURITY DEFINER functions granted
--   to `authenticated`, so a contributor can call them directly through
--   PostgREST with the public anon key + their JWT. They accepted a
--   caller-supplied p_storage_path verbatim — no canonical-path validation, no
--   object-existence check — allowing a direct caller to point a row at
--   quarantine/another-user objects, cross-kind paths, traversal strings, or
--   dangling canonical names. They also did not enforce the
--   forced-password-change flag (Incident #4C added that to the create RPCs
--   only).
--
-- FIX (this migration only):
--   1. Reuse public.is_canonical_resource_path() (Incident #4C) so a
--      storage_path assigned during an update MUST match the exact canonical
--      contract for the resource's kind:
--          summaries/<uuid-v4>.(pdf|jpg|png|webp|gif)   (summary)
--          exams/<uuid-v4>.(pdf|jpg|png|webp|gif)        (exam)
--   2. Additionally require the referenced object to EXIST in the resources
--      bucket (storage.objects). The ONLY writer/mover of canonical objects is
--      the server-side finalizeStoredUpload() boundary (service-role), so
--      canonical + existence == the object was validated and moved by the app.
--      This closes the dangling-canonical-path integrity gap.
--   3. Reject callers whose profile has must_change_password = true (read from
--      public.profiles by auth.uid(), never from client input) — parity with
--      the Incident #4C create-function enforcement and message pattern.
--
-- PRESERVED:
--   * Both signatures byte-for-byte (parameter order, types, defaults, return).
--   * SECURITY DEFINER + `set search_path = public`.
--   * authenticated EXECUTE (NOT service-role-only; anon/service_role grants
--     remain exactly as today — no EXECUTE).
--   * require_contributor() actor derivation + role checks.
--   * ownership rule + admin/owner override.
--   * Existing validations (title/source/type) and update semantics:
--       - update_summary: p_source='content' clears storage_path as before;
--         NULL p_storage_path preserves the existing path (metadata-only edits
--         and content-only edits behave exactly as before).
--       - update_exam: NULL p_storage_path preserves the existing path.
--   * No magic-byte / MIME / size validation, no upload/move/TUS logic, no
--     storage-object ownership columns, no subject/author/is_active changes.
--
-- NOTE: the storage.objects existence check runs as the owner of the SECURITY
--   DEFINER function (postgres), which can read the storage schema; Storage
--   RLS/grants are untouched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. update_summary — forced-password-change guard + canonical/existing path.
-- ----------------------------------------------------------------------------
create or replace function public.update_summary(
  p_id             uuid,
  p_title          text,
  p_title_ar       text default null,
  p_description    text default null,
  p_description_ar text default null,
  p_source         text default 'content',
  p_content        text default null,
  p_videos         text[] default '{}',
  p_storage_path   text default null,
  p_file_name      text default null,
  p_mime_type      text default null,
  p_file_size      bigint default null,
  p_file_url       text default null,
  p_file_size_label text default null,
  p_pages          integer default null,
  p_external_resources jsonb default '[]'::jsonb
)
returns void
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

  -- Forced password change blocks resource mutation (mirrors the app layer
  -- and the Incident #4C create-function guard).
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

  select (author_id = v_actor) into v_owned
    from public.summaries where id = p_id;
  if v_owned is null then
    raise exception 'not found';
  end if;
  if not v_owned
     and v_role not in ('admin'::public.user_role, 'owner'::public.user_role) then
    raise exception 'not allowed';
  end if;

  -- A storage_path is assigned ONLY when switching to 'upload' with a new
  -- path; it must be canonical AND the object must already exist in the
  -- resources bucket (the app's finalizeStoredUpload() issues such paths only
  -- after validating + moving the object). p_source='content' clears the file;
  -- NULL p_storage_path preserves the existing file. Reject instead of
  -- storing an untrusted name (never normalize into a valid path).
  if p_source = 'upload'
     and p_storage_path is not null
     and (
        not public.is_canonical_resource_path(p_storage_path, 'summary')
        or not exists (
          select 1 from storage.objects
           where bucket_id = 'resources'
             and name = p_storage_path
        )
     ) then
    raise exception 'invalid storage path';
  end if;

  update public.summaries
     set title = trim(p_title),
         title_ar = coalesce(p_title_ar, title_ar),
         description = coalesce(p_description, description),
         description_ar = coalesce(p_description_ar, description_ar),
         source = p_source,
         content = case when p_source = 'content' then p_content else null end,
         videos = coalesce(p_videos, '{}'::text[]),
         -- File fields: switching to 'content' clears the file; an 'upload'
         -- edit without a new p_storage_path PRESERVES the existing file (so
         -- "edit the title, keep the same PDF" does not orphan the object).
         storage_path = case
           when p_source = 'content' then null
           when p_storage_path is not null then p_storage_path
           else storage_path
         end,
         file_name = case
           when p_source = 'content' then null
           when p_file_name is not null then p_file_name
           else file_name
         end,
         mime_type = case
           when p_source = 'content' then null
           when p_mime_type is not null then p_mime_type
           else mime_type
         end,
         file_size = case
           when p_source = 'content' then null
           when p_file_size is not null then p_file_size
           else file_size
         end,
         file_url = coalesce(p_file_url, file_url),
         file_size_label = coalesce(p_file_size_label, file_size_label),
         pages = coalesce(p_pages, pages),
         external_resources = coalesce(p_external_resources, '[]'::jsonb)
   where id = p_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. update_exam — forced-password-change guard + canonical/existing path.
-- ----------------------------------------------------------------------------
create or replace function public.update_exam(
  p_id           uuid,
  p_type         text,
  p_year         text default null,
  p_semester     text default null,
  p_storage_path text default null,
  p_file_name    text default null,
  p_mime_type    text default null,
  p_file_size    bigint default null,
  p_file_url     text default null
)
returns void
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

  -- Forced password change blocks resource mutation (mirrors the app layer
  -- and the Incident #4C create-function guard).
  if coalesce(
       (select must_change_password from public.profiles where id = v_actor),
       false
     ) then
    raise exception 'must change password';
  end if;

  if p_type not in ('midterm','final') then
    raise exception 'invalid exam type';
  end if;

  select (author_id = v_actor) into v_owned
    from public.exam_files where id = p_id;
  if v_owned is null then
    raise exception 'not found';
  end if;
  if not v_owned
     and v_role not in ('admin'::public.user_role, 'owner'::public.user_role) then
    raise exception 'not allowed';
  end if;

  -- A storage_path is assigned ONLY when a new path is supplied; it must be
  -- canonical AND the object must already exist in the resources bucket (the
  -- app's finalizeStoredUpload() issues such paths only after validating +
  -- moving the object). NULL p_storage_path preserves the existing file.
  if p_storage_path is not null
     and (
        not public.is_canonical_resource_path(p_storage_path, 'exam')
        or not exists (
          select 1 from storage.objects
           where bucket_id = 'resources'
             and name = p_storage_path
        )
     ) then
    raise exception 'invalid storage path';
  end if;

  update public.exam_files
     set type = p_type,
         year = p_year,
         semester = p_semester,
         storage_path = coalesce(p_storage_path, storage_path),
         file_name = coalesce(p_file_name, file_name),
         mime_type = coalesce(p_mime_type, mime_type),
         file_size = coalesce(p_file_size, file_size),
         file_url = coalesce(p_file_url, file_url)
   where id = p_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Grants: keep authenticated EXECUTE (NOT service-role-only). CREATE OR
--    REPLACE preserves grants, but re-assert explicitly. anon/service_role
--    grants are intentionally untouched (neither had EXECUTE before).
-- ----------------------------------------------------------------------------
revoke all on function public.update_summary from public;
revoke all on function public.update_exam from public;

grant execute on function public.update_summary to authenticated;
grant execute on function public.update_exam to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Reconciliation (SELECT-only, non-mutating). Expected on current local
--    data: 13/13 summary paths canonical, every one present in storage.objects,
--    0 exams. Reports via NOTICE; never modifies rows.
-- ----------------------------------------------------------------------------
do $$
declare
  v_bad_summaries bigint;
  v_bad_exams     bigint;
begin
  select count(*) into v_bad_summaries
    from public.summaries
   where source = 'upload'
     and (
       not public.is_canonical_resource_path(storage_path, 'summary')
       or not exists (
         select 1 from storage.objects
          where bucket_id = 'resources' and name = storage_path
       )
     );

  select count(*) into v_bad_exams
    from public.exam_files
   where (
       not public.is_canonical_resource_path(storage_path, 'exam')
       or not exists (
         select 1 from storage.objects
          where bucket_id = 'resources' and name = storage_path
       )
     );

  raise notice 'update storage_path reconciliation: summaries invalid=%, exams invalid=%',
    v_bad_summaries, v_bad_exams;
end $$;

-- Manual verification (read-only):
--   select id, storage_path from public.summaries
--    where source = 'upload'
--      and not public.is_canonical_resource_path(storage_path, 'summary');
--   select id, storage_path from public.exam_files
--    where not public.is_canonical_resource_path(storage_path, 'exam');