-- ============================================================================
-- Resources / Summaries foundation (Phase 1 + Phase 2).
--
-- Moves the Resources/Summaries section from the browser-only localStorage
-- prototype to real PostgreSQL metadata + Supabase Storage.
--
-- Authorization model (reuses the existing four-role system):
--   * Public/anon: may read only ACTIVE resource metadata (subjects, summary
--     metadata, exam metadata). Students read the same public active data.
--   * Contributors: may create subjects/summaries/exams; may update/delete
--     ONLY resources they authored (author_id = auth.uid()). Writes go through
--     SECURITY DEFINER functions.
--   * admin/owner: full moderation via SECURITY DEFINER functions that reuse
--     the existing require_admin_role() helper (admin vs owner distinction).
--   * No service_role key is used by clients. Author = real auth.uid(), never
--     the prototype's fake CURRENT_USER_ID.
--
-- Storage:
--   * PDF/file BYTES live in Supabase Storage (bucket "resources"), never in
--     PostgreSQL. Only storage_path + display metadata are stored here.
--   * storage_path references the object path in the bucket, e.g.
--     subjects/<subject-id>/summaries/<uuid>.pdf.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. subjects
-- ----------------------------------------------------------------------------
create table public.subjects (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(trim(title)) > 0),
  title_ar    text,
  category    text,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on column public.subjects.category is
  'Localized category id (labels come from the dictionaries). May be NULL for an uncategorized/general subject matching the existing UI fallback.';

-- Fast public listing of active subjects, newest first.
create index subjects_active_idx
  on public.subjects (created_at desc)
  where is_active = true;

-- ----------------------------------------------------------------------------
-- 2. summaries
-- ----------------------------------------------------------------------------
create table public.summaries (
  id           uuid primary key default gen_random_uuid(),
  subject_id   uuid not null references public.subjects(id) on delete cascade,
  title        text not null check (length(trim(title)) > 0),
  title_ar     text,
  description  text,
  description_ar text,
  -- "upload" = file stored in Storage; "content" = inline written text.
  source       text not null default 'content' check (source in ('upload','content')),
  -- Inline written body (source = 'content'). NULL for uploads.
  content      text,
  -- Optional YouTube URLs (never required to publish).
  videos       text[] not null default '{}',
  -- Storage object path (source = 'upload'). NULL for inline content.
  storage_path text,
  file_name    text,
  mime_type    text,
  file_size    bigint,
  -- Display-only metadata for a static/legacy committee file reference.
  file_url         text,
  file_size_label  text,
  pages            integer,
  -- Committee editorial summaries may carry a curated list of external
  -- resources (e.g. a YouTube lecture). Mirrors the existing type.
  external_resources jsonb not null default '[]'::jsonb,
  author_id    uuid not null references public.profiles(id) on delete cascade,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on column public.summaries.storage_path is
  'Supabase Storage object path (e.g. subjects/<id>/summaries/<uuid>.pdf). NULL when source = ''content''.';

create index summaries_subject_active_idx
  on public.summaries (subject_id, created_at desc)
  where is_active = true;

-- ----------------------------------------------------------------------------
-- 3. exam_files
-- ----------------------------------------------------------------------------
create table public.exam_files (
  id           uuid primary key default gen_random_uuid(),
  subject_id   uuid not null references public.subjects(id) on delete cascade,
  type         text not null check (type in ('midterm','final')),
  year         text,
  semester     text check (semester is null or semester in ('first','second','summer')),
  storage_path text not null,
  file_name    text not null,
  mime_type    text,
  file_size    bigint,
  -- Optional static reference for a committee-sourced exam.
  file_url     text,
  author_id    uuid not null references public.profiles(id) on delete cascade,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on column public.exam_files.storage_path is
  'Supabase Storage object path (e.g. subjects/<id>/exams/<uuid>.pdf).';

create index exam_files_subject_active_idx
  on public.exam_files (subject_id, created_at desc)
  where is_active = true;

-- ----------------------------------------------------------------------------
-- 4. Auto-maintain updated_at
-- ----------------------------------------------------------------------------
create or replace function public.set_resources_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger subjects_updated_at
  before update on public.subjects
  for each row execute function public.set_resources_updated_at();
create trigger summaries_updated_at
  before update on public.summaries
  for each row execute function public.set_resources_updated_at();
create trigger exam_files_updated_at
  before update on public.exam_files
  for each row execute function public.set_resources_updated_at();

-- ----------------------------------------------------------------------------
-- 5. RLS
-- ----------------------------------------------------------------------------
alter table public.subjects enable row level security;
alter table public.summaries enable row level security;
alter table public.exam_files enable row level security;

-- Public read: active metadata only. Applies to anon (public pages), students
-- and contributors alike. All authenticated WRITE access goes through the
-- SECURITY DEFINER functions below; no direct INSERT/UPDATE/DELETE policies
-- exist, so RLS blocks any bypass by the anon/authenticated keys.
create policy "public can read active subjects"
  on public.subjects for select to anon, authenticated
  using (is_active = true);

create policy "public can read active summaries"
  on public.summaries for select to anon, authenticated
  using (is_active = true);

create policy "public can read active exam files"
  on public.exam_files for select to anon, authenticated
  using (is_active = true);

-- ----------------------------------------------------------------------------
-- 6. SECURITY DEFINER helpers
-- ----------------------------------------------------------------------------

-- Requires an authenticated CONTRIBUTOR (or above). Returns the actor id.
-- Used by every contributor resource mutation. Admin/owner path is separate
-- (require_admin_role()).
create or replace function public.require_contributor()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_role public.user_role;
begin
  if actor is null then
    raise exception 'not authenticated';
  end if;

  select role into actor_role from public.profiles where id = actor;
  if actor_role is null
     or actor_role not in ('contributor'::public.user_role,
                           'admin'::public.user_role,
                           'owner'::public.user_role) then
    raise exception 'insufficient privileges';
  end if;

  return actor;
end;
$$;

revoke all on function public.require_contributor() from public;
grant execute on function public.require_contributor() to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Contributor mutations
--    SECURITY DEFINER. Functions are passed the storage_path from the server
--    action (which already uploaded the bytes to Supabase Storage and thereby
--    validated MIME/size). Ownership is enforced here via author_id.
-- ----------------------------------------------------------------------------

-- Create a subject; returns its id.
create or replace function public.create_subject(
  p_title     text,
  p_title_ar  text default null,
  p_category  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_id    uuid;
begin
  v_actor := public.require_contributor();
  if p_title is null or trim(p_title) = '' then
    raise exception 'title is required';
  end if;

  insert into public.subjects (title, title_ar, category, author_id)
  values (trim(p_title), p_title_ar, p_category, v_actor)
  returning id into v_id;

  return v_id;
end;
$$;

-- Rename a subject: owner OR admin/owner.
create or replace function public.update_subject(
  p_id       uuid,
  p_title    text,
  p_title_ar text default null,
  p_category text default null
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
  if p_title is null or trim(p_title) = '' then
    raise exception 'title is required';
  end if;

  select (author_id = v_actor) into v_owned
    from public.subjects where id = p_id;
  if v_owned is null then
    raise exception 'not found';
  end if;
  if not v_owned
     and v_role not in ('admin'::public.user_role, 'owner'::public.user_role) then
    raise exception 'not allowed';
  end if;

  update public.subjects
     set title = trim(p_title),
         title_ar = coalesce(p_title_ar, title_ar),
         category = coalesce(p_category, category)
   where id = p_id;
end;
$$;

-- Soft delete a subject. Owner, or admin/owner moderator.
-- Storage objects are NOT removed here (the server action removes them
-- separately after a successful soft delete).
create or replace function public.delete_subject(p_id uuid)
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

  select (author_id = v_actor) into v_owned
    from public.subjects where id = p_id;
  if v_owned is null then
    raise exception 'not found';
  end if;
  if not v_owned
     and v_role not in ('admin'::public.user_role, 'owner'::public.user_role) then
    raise exception 'not allowed';
  end if;

  update public.subjects set is_active = false where id = p_id;
end;
$$;

-- Create a summary (uploaded file or inline content). Returns its id.
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

  select id into v_subj from public.subjects where id = p_subject_id;
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

-- Update a summary. Owner (or admin/owner).
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

-- Soft delete a summary. Owner (or admin/owner).
create or replace function public.delete_summary(p_id uuid)
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

  select (author_id = v_actor) into v_owned
    from public.summaries where id = p_id;
  if v_owned is null then
    raise exception 'not found';
  end if;
  if not v_owned
     and v_role not in ('admin'::public.user_role, 'owner'::public.user_role) then
    raise exception 'not allowed';
  end if;

  update public.summaries set is_active = false where id = p_id;
end;
$$;

-- Create an exam file. Returns its id.
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

  select id into v_subj from public.subjects where id = p_subject_id;
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

-- Update an exam file. Owner (or admin/owner).
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

-- Soft delete an exam file. Owner (or admin/owner).
create or replace function public.delete_exam(p_id uuid)
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

  select (author_id = v_actor) into v_owned
    from public.exam_files where id = p_id;
  if v_owned is null then
    raise exception 'not found';
  end if;
  if not v_owned
     and v_role not in ('admin'::public.user_role, 'owner'::public.user_role) then
    raise exception 'not allowed';
  end if;

  update public.exam_files set is_active = false where id = p_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. Least-privilege grants.
--    Public reads work via RLS + table grants below. Mutations are ONLY
--    through the SECURITY DEFINER functions.
-- ----------------------------------------------------------------------------
revoke all on table public.subjects, public.summaries, public.exam_files from public;
grant select on public.subjects, public.summaries, public.exam_files to anon, authenticated;

revoke all on function public.create_subject(text, text, text) from public;
revoke all on function public.update_subject(uuid, text, text, text) from public;
revoke all on function public.delete_subject(uuid) from public;
revoke all on function public.create_summary(uuid, text, text, text, text, text, text, text[], text, text, text, bigint, text, text, integer, jsonb) from public;
revoke all on function public.update_summary(uuid, text, text, text, text, text, text, text[], text, text, text, bigint, text, text, integer, jsonb) from public;
revoke all on function public.delete_summary(uuid) from public;
revoke all on function public.create_exam(uuid, text, text, text, text, text, text, bigint, text) from public;
revoke all on function public.update_exam(uuid, text, text, text, text, text, text, bigint, text) from public;
revoke all on function public.delete_exam(uuid) from public;

grant execute on function public.create_subject(text, text, text) to authenticated;
grant execute on function public.update_subject(uuid, text, text, text) to authenticated;
grant execute on function public.delete_subject(uuid) to authenticated;
grant execute on function public.create_summary(uuid, text, text, text, text, text, text, text[], text, text, text, bigint, text, text, integer, jsonb) to authenticated;
grant execute on function public.update_summary(uuid, text, text, text, text, text, text, text[], text, text, text, bigint, text, text, integer, jsonb) to authenticated;
grant execute on function public.delete_summary(uuid) to authenticated;
grant execute on function public.create_exam(uuid, text, text, text, text, text, text, bigint, text) to authenticated;
grant execute on function public.update_exam(uuid, text, text, text, text, text, text, bigint, text) to authenticated;
grant execute on function public.delete_exam(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 9. Storage bucket (Phase 3).
--    Objects are private by default. Server actions upload with the
--    service-role key and generate short-lived signed URLs for reading.
--    An authenticated user may NOT upload directly to the bucket via client
--    keys — all writes go through the server actions.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('resources', 'resources', false)
on conflict (id) do nothing;

-- No INSERT/UPDATE/DELETE storage policies: only the service-role client
-- (server actions) can manage objects directly. There are no client-upload
-- policies, which is exactly what we want — contributors upload through the
-- server action that validates MIME/size first.
