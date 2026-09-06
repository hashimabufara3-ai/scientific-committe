-- ============================================================================
-- Contributor activity feed — persisted "Recent Activity" for the contributor
-- dashboard.
--
-- Background
--   The dashboard's "Recent Activity" card was previously filled only by
--   client-session React state (pushActivity) that started empty, was lost on
--   refresh, and showed only the current browser session's actions. This
--   migration adds a small, dedicated, PUBLIC-SAFE persistence layer for the
--   feed so recent contributor actions survive refresh / navigation / restart
--   and are visible to every contributor (the feed intentionally shows what
--   OTHER contributors have done, complementing "My Contributions").
--
-- Deliberately NOT the admin audit_log
--   public.audit_log remains untouched. It stores sensitive administrative
--   records (actor_email, target metadata, account lifecycle events) under an
--   admin/owner-only read policy and must not be exposed to contributors. The
--   new contributor_activity table stores only the minimum public-safe fields
--   the feed needs and is readable EXCLUSIVELY through a dedicated SECURITY
--   DEFINER function that never returns the actor id (or any other private
--   field).
--
-- Security model
--   * Writes: only through record_contributor_activity(). SECURITY DEFINER.
--     The actor is ALWAYS derived from auth.uid() inside the function — the
--     client can never choose who performed the action.
--   * AUTHORITATIVE ANCHORING: the event title(s) / exam label are NOT taken
--     from the client. The function looks up the actual resource row
--     (subjects / summaries / exam_files) by id and reads its stored fields,
--     then verifies the acting contributor authored that row (or is
--     admin/owner). A caller therefore cannot fabricate, re-attribute or
--     invent feed events — an event exists only if the authoritative row
--     exists and the actor owns it.
--   * Length caps: title_en/title_ar are capped at 200 characters at BOTH the
--     table level (check constraints) and inside the write function
--     (truncation). Oversized input can never be stored.
--   * Reads: only through recent_contributor_activity(). SECURITY DEFINER,
--     requires a contributor-or-above session (require_contributor()). It
--     returns: an opaque row id (React key), is_own (viewer vs. someone else),
--     the actor's PUBLIC committee display name ONLY when the actor has an
--     active committee_members record (profiles.full_name — a private profile
--     field — is never exposed), the action code, the stored bilingual title
--     fields, exam_type and created_at. It NEVER returns actor_id, email,
--     username, or any profile columns.
--   * RLS is enabled with NO client SELECT/INSERT/UPDATE/DELETE policies:
--     PostgREST clients can never read the raw table (which would expose
--     actor_id) nor write to it directly. As defense-in-depth, the table has
--     zero grants to public/anon/authenticated as well.
--   * The existing admin audit_log table and ALL of its policies are
--     completely untouched by this migration.
--
-- Smallest safe scope
--   Only the 5 actions the contributor workflow actually performs are
--   recorded: subject / summary / exam (creation), edit, delete. No generic
--   event platform is introduced.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. contributor_activity
-- ----------------------------------------------------------------------------
create table public.contributor_activity (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid not null references public.profiles(id) on delete cascade,
  action      text not null check (action in ('subject','summary','exam','edit','delete')),
  title_en    text,
  title_ar    text,
  exam_type   text,
  created_at  timestamptz not null default now(),
  -- Actor-facing titles are capped at 200 characters (bounded feed rows).
  check (title_en is null or char_length(title_en) <= 200),
  check (title_ar is null or char_length(title_ar) <= 200),
  -- A row must describe something: a title (subject/summary/edit/delete) or an
  -- exam label (exam events resolve the localized label from exam_type).
  check (exam_type is null or exam_type in ('midterm','final')),
  check (btrim(coalesce(title_en, '')) <> '' or exam_type is not null)
);

comment on table public.contributor_activity is
  'Public contributor activity feed. Stores only the minimal fields the dashboard feed displays. The actor id is never exposed to clients.';

comment on column public.contributor_activity.actor_id is
  'Reference to the acting profile. Never returned by recent_contributor_activity() — reads resolve only the public display name.';

-- The feed is read newest-first with a small LIMIT; a write scan is never
-- used, so the (created_at desc) index fully covers the read path.
create index contributor_activity_created_at_idx
  on public.contributor_activity (created_at desc);

alter table public.contributor_activity enable row level security;

-- No SELECT policy: the raw table (which includes actor_id) is never readable
-- by any client. Reads happen only via recent_contributor_activity().
-- No INSERT/UPDATE/DELETE policies: writes happen only through
-- record_contributor_activity() (SECURITY DEFINER).
-- Defense-in-depth: no grants at all to public / anon / authenticated.
revoke all on table public.contributor_activity from public;
revoke all on table public.contributor_activity from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. record_contributor_activity — the ONLY write path.
--    Actor is derived from auth.uid(); the event text is derived from the
--    AUTHORITATIVE resource row (never from the client). Raises when the
--    caller is not contributor-or-above, the resource is missing, or the
--    caller does not own it (unless admin/owner).
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
  v_actor     uuid;
  v_role      public.user_role;
  v_author    uuid;
  v_title_en  text;
  v_title_ar  text;
  v_exam_type text;
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
  if p_kind = 'subject' then
    select s.title, s.title_ar, s.author_id
      into v_title_en, v_title_ar, v_author
      from public.subjects s where s.id = p_id;
  elsif p_kind = 'summary' then
    select s.title, s.title_ar, s.author_id
      into v_title_en, v_title_ar, v_author
      from public.summaries s where s.id = p_id;
  else
    select e.type, e.author_id
      into v_exam_type, v_author
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

  insert into public.contributor_activity (actor_id, action, title_en, title_ar, exam_type)
  values (
    v_actor,
    p_action,
    case when p_kind = 'exam' then null
         else left(btrim(coalesce(v_title_en, '')), 200) end,
    case when p_kind = 'exam' then null
         else nullif(left(btrim(coalesce(v_title_ar, '')), 200), '') end,
    case when p_kind = 'exam' then v_exam_type else null end
  );
end;
$$;

revoke all on function public.record_contributor_activity(text, text, uuid) from public;
grant execute on function public.record_contributor_activity(text, text, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. recent_contributor_activity — the ONLY read path.
--    Requires a contributor-or-above session. Returns ONLY public-safe
--    fields; actor_id / email / username / profiles columns are never
--    exposed. Display names come ONLY from the actor's active committee_members
--    record (the project's public member roster); profiles.full_name is a
--    private field and is never joined here. A blank name resolves to NULL and
--    the UI falls back to a localized anonymous label.
-- ----------------------------------------------------------------------------
create or replace function public.recent_contributor_activity(p_limit integer default 8)
returns table (
  id            uuid,
  is_own        boolean,
  actor_name_en text,
  actor_name_ar text,
  action        text,
  title_en      text,
  title_ar      text,
  exam_type     text,
  created_at    timestamptz
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
           ca.created_at
      from public.contributor_activity ca
      left join public.committee_members cm
        on cm.user_id = ca.actor_id and cm.is_active = true
     order by ca.created_at desc
     limit v_limit;
end;
$$;

revoke all on function public.recent_contributor_activity(integer) from public;
grant execute on function public.recent_contributor_activity(integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Verification queries (read-only, safe to re-run)
-- ----------------------------------------------------------------------------
-- select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'contributor_activity';
-- select policyname, cmd, qual from pg_policies where schemaname = 'public' and tablename = 'contributor_activity'; -- expect 0 rows (all access via functions)
-- select proname, prosecdef, pg_get_function_arguments(oid) from pg_proc where proname in ('record_contributor_activity', 'recent_contributor_activity');
-- select has_table_privilege('anon',    'public.contributor_activity', 'select'), has_table_privilege('anon',    'public.contributor_activity', 'insert'); -- false, false
-- select has_table_privilege('authenticated', 'public.contributor_activity', 'select'), has_table_privilege('authenticated', 'public.contributor_activity', 'insert'); -- false, false
-- select * from public.recent_contributor_activity(8);