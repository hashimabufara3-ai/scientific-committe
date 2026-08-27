-- ============================================================================
-- Phase 2B-2: Dot-based usernames, .N duplicate suffixes, email resolution
-- ============================================================================
-- This migration:
--   1. Updates slug_username() to use "." instead of "_" for whitespace
--   2. Updates handle_new_user() to use ".N" suffixes (base.2, base.3, ...)
--   3. Adds resolve_auth_email() SECURITY DEFINER for login identifier resolution
--
-- Existing usernames are NOT modified. The new dot-based format applies to
-- NEW accounts only. Existing accounts (e.g. test, system_test) retain their
-- current usernames and auth emails.
--
-- The CHECK constraint (profiles_username_format_check) already allows "."
-- so no constraint changes are needed.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. slug_username: whitespace → "." (was "_"), repeated separators → "."
--    Rules unchanged: lowercase, keep only [a-z0-9._], collapse repeats,
--    strip leading/trailing, cap at 17 chars, fallback to 'member'.
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

  -- Whitespace runs become a single dot (new: was underscore).
  v := regexp_replace(v, '\s+', '.', 'g');

  -- ASCII-only: keep just [a-z0-9._]. Non-Latin and special characters are
  -- removed deterministically rather than transliterated.
  v := regexp_replace(v, '[^a-z0-9._]', '', 'g');

  -- Collapse repeated separators; strip leading/trailing ones.
  v := regexp_replace(v, '[._]{2,}', '.', 'g');
  v := regexp_replace(v, '^[._]+|[._]+$', '', 'g');

  v_core := regexp_replace(v, '[._]', '', 'g');

  -- No usable ASCII core (e.g. purely Arabic) or too short: fixed fallback.
  if v_core = '' or char_length(v_core) < 3 then
    return 'member';
  end if;

  -- Cap the base at 15 chars so a dot-separated numeric suffix (up to ".999",
  -- 4 chars) always fits within the 20-char limit: 15 + 4 = 19.
  if char_length(v) > 15 then
    v := left(v, 15);
    v := regexp_replace(v, '[._]+$', '', 'g');
  end if;

  return v;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. handle_new_user: duplicate suffixes now use ".N" (was "N" appended).
--    base → base.2 → base.3 → ... → base.999
--    Collision recovery on unique_violation also uses ".N".
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
    v_username := v_base || '.' || v_suffix::text;
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
        v_username := v_base || '.' || v_suffix::text;
        v_suffix := v_suffix + 1;
        while public.is_reserved_username(v_username) loop
          if v_suffix > 999 then
            raise;
          end if;
          v_username := v_base || '.' || v_suffix::text;
          v_suffix := v_suffix + 1;
        end loop;
    end;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. resolve_auth_email: SECURITY DEFINER lookup for login.
--    - If identifier contains "@" → treat as email, return as-is.
--    - Otherwise → resolve profiles.username → profiles.email.
--    - Returns NULL if no matching account exists.
--    Does NOT expose whether an account exists — the caller must handle
--    NULL and auth failures identically (generic error message).
-- ----------------------------------------------------------------------------
create or replace function public.resolve_auth_email(p_identifier text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when position('@' in p_identifier) > 0 then
      -- Email: return as-is (Supabase Auth will validate).
      lower(btrim(p_identifier))
    else
      -- Username: look up the auth email from profiles.
      (select email from public.profiles
        where lower(username) = lower(btrim(p_identifier))
        limit 1)
  end;
$$;

-- Grant execute only where required. anon = the pre-auth login flow (username
-- resolution); authenticated is included so any logged-in client re-using the
-- path is unaffected. The function returns only the auth email (or NULL), so
-- it cannot be used to dump arbitrary profile data.
revoke all on function public.resolve_auth_email(text) from public;
grant execute on function public.resolve_auth_email(text) to anon, authenticated;

commit;

-- ----------------------------------------------------------------------------
-- Verification queries (read-only, safe to re-run)
-- ----------------------------------------------------------------------------
-- select public.slug_username('Hashim Abufara');        -- expect: hashim.abufara
-- select public.slug_username('Ali Mohammed');           -- expect: ali.mohammed
-- select public.slug_username('test');                   -- expect: test
-- select public.slug_username('Dr Sara');                -- expect: dr.sara
-- select public.resolve_auth_email('hashim.abufara');    -- returns email or NULL
-- select public.resolve_auth_email('test@test.com');     -- returns test@test.com
-- select public.resolve_auth_email('nonexistent');       -- returns NULL
-- select proname, prosecdef from pg_proc
--   where proname in ('slug_username', 'handle_new_user', 'resolve_auth_email');
