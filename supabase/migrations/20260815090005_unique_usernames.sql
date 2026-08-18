-- ============================================================================
-- Phase A: Unique usernames (corrected specification).
--
-- ONE-SHOT MIGRATION. It is intentionally NOT idempotent. The DDL (column,
-- index, constraints) and the backfill must run exactly once; running any
-- step again fails or double-applies by design. There are NO IF NOT EXISTS
-- shims that could hide a partially-applied migration. The whole script is
-- wrapped in BEGIN/COMMIT so any failure rolls everything back atomically.
-- Functions below use CREATE OR REPLACE only because functions are
-- re-creatable by nature (that is not a partial-application workaround).
--
-- Username rules (enforced in the database AND mirrored in the application):
--   * 3-20 characters
--   * lowercase ASCII only: a-z, 0-9, underscore, period
--   * must start and end with a-z or 0-9
--   * no consecutive periods
--   * hyphens are NOT allowed
--   * Unicode / Arabic characters are NOT allowed in usernames
--   * full_name may contain Arabic; username is always ASCII
--
-- Uniqueness — the database is the FINAL authority. A unique index on
-- lower(username) enforces case-insensitive uniqueness no matter what the
-- application sends. A CHECK constraint additionally requires the canonical
-- format, requires lowercase (username = lower(username)), and rejects the
-- reserved list.
--
-- Reserved usernames (never assignable): admin, owner, coadmin, moderator,
-- support, staff, committee, scientific, root, system.
--
-- Existing users — deterministic backfill, full_name ONLY (never email),
-- assigned in created_at order (ties broken by id). The first profile to
-- claim a base slug keeps it; later duplicates get the next free numeric
-- suffix (base2, base3, ...). slug_username() is ASCII-only; for Arabic /
-- non-Latin names (PostgreSQL has no transliteration) the deterministic
-- fallback base is "member", then member2, member3, ...
--
-- Privacy / RBAC
--   * No existing RLS policy is modified or weakened.
--   * Roles stay immutable through client updates (the "update own profile"
--     with-check is untouched); changing username is a normal owner-side
--     update confined to the caller's own row.
--   * admin_list_members() returns id, full_name, username, role, created_at —
--     NEVER email — authorized via auth.uid() under SECURITY DEFINER, with the
--     broad admin-read SELECT policy kept removed.
--   * The four-role RBAC and the auth callback/email-confirmation flow are
--     completely untouched by this migration.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Column. Nullable so the backfill below can run before NOT NULL.
-- ----------------------------------------------------------------------------
alter table public.profiles add column username text;

-- ----------------------------------------------------------------------------
-- 2. Reserved username list. The CHECK constraint and every assignment path
--    (backfill, trigger, availability RPC) consult this single source.
-- ----------------------------------------------------------------------------
create or replace function public.is_reserved_username(p_username text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(btrim(p_username)) = any (
    array['admin','owner','coadmin','moderator','support','staff',
          'committee','scientific','root','system']::text[]
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. Deterministic ASCII slug generator (pure, immutable).
--    - lowercases
--    - keeps ONLY [a-z0-9._]; everything else (Arabic, accents, hyphens,
--      punctuation) is removed deterministically — output is always ASCII
--    - collapses repeated separators, strips leading/trailing ones
--    - never uses email
--    - falls back to 'member' when there is no usable ASCII core
--      (e.g. a purely Arabic name) or the core is shorter than 3 chars
--    - caps the base at 17 so the claim-time numeric suffix (2..999) keeps the
--      final username within the 20-char limit
-- ----------------------------------------------------------------------------
create or replace function public.slug_username(p_name text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text;
  v_core text;
begin
  v := lower(btrim(coalesce(p_name, '')));
  if v = '' then
    return 'member';
  end if;

  -- Whitespace runs become a single underscore.
  v := regexp_replace(v, '\s+', '_', 'g');

  -- ASCII-only: keep just [a-z0-9._]. Non-Latin and special characters are
  -- removed deterministically rather than transliterated.
  v := regexp_replace(v, '[^a-z0-9._]', '', 'g');

  -- Collapse repeated separators; strip leading/trailing ones.
  v := regexp_replace(v, '[._]{2,}', '_', 'g');
  v := regexp_replace(v, '^[._]+|[._]+$', '', 'g');

  v_core := regexp_replace(v, '[._]', '', 'g');

  -- No usable ASCII core (e.g. purely Arabic) or too short: fixed fallback.
  if v_core = '' or char_length(v_core) < 3 then
    return 'member';
  end if;

  -- Cap the base at 17 chars so a numeric suffix (up to 999) fits in 20.
  if char_length(v) > 17 then
    v := left(v, 17);
    v := regexp_replace(v, '[._]+$', '', 'g');
  end if;

  return v;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Requested-or-slug: prefer a requested username that satisfies the exact
--    canonical rules AND is not reserved; otherwise fall back to the
--    deterministic full_name slug. Never uses email.
-- ----------------------------------------------------------------------------
create or replace function public.requested_or_slug_username(p_requested text, p_full_name text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text;
begin
  v := lower(btrim(coalesce(p_requested, '')));
  if v <> ''
     and v ~ '^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$'
     and v !~ '\.\.'
     and not public.is_reserved_username(v) then
    return v;
  end if;
  return public.slug_username(p_full_name);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Backfill existing users — deterministic, full_name ONLY, in created_at
--    order (ties broken by id). First claimant keeps the base slug; later
--    duplicates (and any reserved base, e.g. a user literally named "Admin")
--    get the next free numeric suffix. Never uses email. Results satisfy the
--    exact same CHECK constraint that is added in section 6.
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
  v_base text;
  v_username text;
  v_suffix int;
begin
  for r in
    select id, full_name
      from public.profiles
     order by created_at asc, id asc
  loop
    v_base := public.slug_username(r.full_name);
    v_username := v_base;
    v_suffix := 2;
    while exists (select 1 from public.profiles where lower(username) = lower(v_username))
       or public.is_reserved_username(v_username) loop
      if v_suffix > 999 then
        raise exception 'username suffix exhausted for user %', r.id;
      end if;
      v_username := v_base || v_suffix::text;
      v_suffix := v_suffix + 1;
    end loop;
    update public.profiles set username = v_username where id = r.id;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 6. Hard invariants — enforced by the database itself.
--    * NOT NULL
--    * case-insensitive uniqueness via unique index on lower(username)
--    * format CHECK: canonical regex + lowercase + not reserved
-- ----------------------------------------------------------------------------
alter table public.profiles alter column username set not null;

create unique index profiles_username_unique_idx
  on public.profiles (lower(username));

alter table public.profiles
  add constraint profiles_username_format_check
  check (
    username = lower(username)
    and username ~ '^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$'
    and username !~ '\.\.'
    and not public.is_reserved_username(username)
  );

-- ----------------------------------------------------------------------------
-- 7. Profile creation trigger now records the username. Username comes only
--    from signup metadata (never email), validated with the same canonical
--    rules as everything else. Reserved names are escalated past
--    deterministically. On a concurrent unique-violation race only a username
--    collision (profiles_username_unique_idx) is recovered by re-claiming;
--    any other unique violation propagates.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text;
  v_base text;
  v_username text;
  v_suffix int := 2;
begin
  v_full_name := coalesce(new.raw_user_meta_data ->> 'full_name', '');
  v_base := public.slug_username(v_full_name);
  v_username := public.requested_or_slug_username(
    new.raw_user_meta_data ->> 'username',
    v_full_name
  );

  -- Reserved names are never assignable: escalate deterministically.
  while public.is_reserved_username(v_username) loop
    if v_suffix > 999 then
      raise exception 'username suffix exhausted for user %', new.id;
    end if;
    v_username := v_base || v_suffix::text;
    v_suffix := v_suffix + 1;
  end loop;

  loop
    begin
      insert into public.profiles (id, full_name, email, username)
      values (new.id, v_full_name, new.email, v_username);
      return new;
    exception
      when unique_violation then
        -- Only a username collision is recoverable. Anything else (e.g. the
        -- email unique index) must fail the signup rather than be swallowed.
        if position('profiles_username_unique_idx' in sqlerrm) = 0 then
          raise;
        end if;
        if v_suffix > 999 then
          raise;
        end if;
        v_username := v_base || v_suffix::text;
        v_suffix := v_suffix + 1;
        while public.is_reserved_username(v_username) loop
          if v_suffix > 999 then
            raise;
          end if;
          v_username := v_base || v_suffix::text;
          v_suffix := v_suffix + 1;
        end loop;
    end;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. username_available: advisory pre-check for the UI. Normalizes and
--    validates the requested username, returns false for invalid or reserved
--    names, and returns false when lower(username) already exists. SECURITY
--    DEFINER so it can look across rows the caller could not SELECT directly;
--    it only leaks the existence of a public identifier. Granted to anon
--    (signup form) and authenticated (account editor). The unique index in
--    section 6 remains the final authority.
-- ----------------------------------------------------------------------------
create or replace function public.username_available(p_username text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text;
begin
  v := lower(btrim(coalesce(p_username, '')));

  if v !~ '^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$' or v ~ '\.\.' then
    return false;
  end if;

  if public.is_reserved_username(v) then
    return false;
  end if;

  return not exists (
    select 1
      from public.profiles
     where lower(username) = v
  );
end;
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 9. Admin member listing exposes username (a public identifier) and searches
--    it case-insensitively. It STILL returns NEVER email and still verifies
--    the caller is admin/owner via auth.uid(). The RLS admin-read policy
--    stays removed — everything flows through this RPC.
-- ----------------------------------------------------------------------------
create or replace function public.admin_list_members(search text default null)
returns table (
  id uuid,
  full_name text,
  username text,
  role public.user_role,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_role public.user_role;
begin
  select role into actor_role from public.profiles where id = auth.uid();
  if actor_role is null
     or actor_role not in ('admin'::public.user_role, 'owner'::public.user_role) then
    raise exception 'insufficient privileges';
  end if;

  if search is null or btrim(search) = '' then
    return query
      select p.id, p.full_name, p.username, p.role, p.created_at
        from public.profiles p
       order by p.created_at asc;
  else
    return query
      select p.id, p.full_name, p.username, p.role, p.created_at
        from public.profiles p
       where position(lower(search) in lower(p.full_name)) > 0
          or position(lower(search) in lower(p.username)) > 0
       order by p.created_at asc;
  end if;
end;
$$;

revoke all on function public.admin_list_members(text) from public;
grant execute on function public.admin_list_members(text) to authenticated;

commit;

-- ----------------------------------------------------------------------------
-- 10. Verification queries (read-only, safe to re-run)
-- ----------------------------------------------------------------------------
-- select count(*), count(distinct lower(username)) from public.profiles;  -- equal
-- select id, full_name, username, role, created_at from public.profiles order by created_at;
-- select proname, prosecdef from pg_proc where proname in ('is_reserved_username', 'slug_username', 'requested_or_slug_username', 'handle_new_user', 'username_available', 'admin_list_members');
-- select indexname, indexdef from pg_indexes where tablename = 'profiles';
-- select tablename, policyname from pg_policies where schemaname = 'public' and tablename = 'profiles';
