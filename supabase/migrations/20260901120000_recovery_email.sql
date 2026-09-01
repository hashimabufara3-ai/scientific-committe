-- ============================================================================
-- External recovery-email foundation.
--
-- Adds an OPTIONAL external recovery email (e.g. user@gmail.com) that is
-- SEPARATE from the primary @ptuksc.com identity stored in auth.users.email.
--   - auth.users.email is NEVER modified here.
--   - recovery data is stored on public.profiles, NOT on auth.users or in
--     raw_user_meta_data.
--
-- Changes (all additive, backward-compatible):
--   1. profiles.recovery_email                (text, NULL)
--   2. profiles.recovery_email_confirmed_at   (timestamptz, NULL)
--   3. DB-authoritative unique index on lower(trim(recovery_email))
--      (only for non-NULL values) so one recovery address can belong to at
--      most one account.
--   4. SECURITY DEFINER RPCs:
--        - set_recovery_email(text)
--        - get_recovery_email_status()
--        - confirm_recovery_email()
--        - clear_recovery_email()
--      Every function derives the actor from auth.uid(), pins search_path,
--      and carries least-privilege EXECUTE grants. None exposes unrelated
--      profiles or allows broad writes.
--   5. Audit events via the existing log_audit_event() helper:
--        recovery_email_set / recovery_email_changed / recovery_email_confirmed
--        / recovery_email_cleared
--      NEVER store the raw recovery email or any token in audit details.
--
-- Does NOT:
--   - create a custom recovery_tokens table (native Supabase links are used)
--   - add broad SELECT/UPDATE policies to profiles
--   - weaken existing RLS / RBAC
--   - modify auth.users
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1 & 2. profiles columns
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column recovery_email text,
  add column recovery_email_confirmed_at timestamptz;

-- ----------------------------------------------------------------------------
-- 3. DB-authoritative uniqueness on normalized recovery email.
--    Only enforced when recovery_email is non-NULL (partial index). The cast to
--    text keeps the comparison unambiguous; lower(trim(...)) matches the
--    normalization used by the application (same pattern as the case-insensitive
--    username uniqueness in 20260815090005_unique_usernames.sql).
-- ----------------------------------------------------------------------------
create unique index profiles_recovery_email_unique_idx
  on public.profiles ((lower(trim(recovery_email))))
  where recovery_email is not null;

-- ----------------------------------------------------------------------------
-- 4a. set_recovery_email(text)
--     Stores the caller's recovery-email candidate as UNVERIFIED (confirmed_at
--     NULL) or, if the incoming normalized value matches the already-verified
--     one, leaves it verified. Rejects the caller's own primary auth email and
--     any @ptuksc.com address (recovery must be an external address).
--
--     The existing verified recovery email is treated as authoritative for
--     recovery dispatch: forgot-password only uses addresses whose
--     confirmed_at is non-NULL. Replacing a verified value therefore requires a
--     fresh verification link; until then the old value is not usable for
--     external recovery (there is no "pending" second slot in this schema).
-- ----------------------------------------------------------------------------
create or replace function public.set_recovery_email(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid;
  v_norm         text;
  v_primary      text;
  v_previous     text;
  v_was_verified boolean;
  v_duplicate_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  v_norm := lower(btrim(coalesce(p_email, '')));
  if v_norm = '' or position('@' in v_norm) = 0 then
    raise exception 'invalid recovery email';
  end if;

  -- Recovery address must be external, never the primary @ptuksc.com identity.
  if v_norm ~ '@ptuksc\.com$' then
    raise exception 'recovery email must be an external address';
  end if;

  -- Resolve the caller's primary auth email and reject using it as recovery.
  select email into v_primary from auth.users where id = v_uid;
  if v_primary is not null and lower(trim(v_primary)) = v_norm then
    raise exception 'recovery email cannot be the account identity';
  end if;

  -- One recovery address per account (DB index is the final authority; this
  -- pre-check gives a friendlier error before the constraint fires).
  select id into v_duplicate_id
    from public.profiles
   where lower(trim(recovery_email)) = v_norm
     and id <> v_uid
   limit 1;
  if v_duplicate_id is not null then
    raise exception 'recovery email already in use';
  end if;

  -- Capture previous state for change detection / audit.
  select recovery_email, recovery_email_confirmed_at is not null
    into v_previous, v_was_verified
    from public.profiles
   where id = v_uid;

  if v_previous is not null and lower(trim(v_previous)) = v_norm then
    -- Same address: no-op unless we are re-requesting verification.
    -- If it was already verified, nothing to do.
    if v_was_verified then
      return;
    end if;
  end if;

  -- Store as unverified. A verification link must be confirmed afterwards.
  update public.profiles
     set recovery_email = v_norm,
         recovery_email_confirmed_at = null
   where id = v_uid;

  -- Audit: never log the raw address.
  if v_previous is not null and lower(trim(v_previous)) <> v_norm then
    perform public.log_audit_event('recovery_email_changed', 'profile', v_uid);
  else
    perform public.log_audit_event('recovery_email_set', 'profile', v_uid);
  end if;
end;
$$;

revoke all on function public.set_recovery_email(text) from public;
grant execute on function public.set_recovery_email(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4b. get_recovery_email_status()
--     Returns ONLY a masked representation of the caller's own recovery email
--     plus its verification state. The full address is never exposed to the
--     client through this function's output; the application masks it further
--     before any UI rendering. Never returns another user's data (filtered by
--     auth.uid()).
-- ----------------------------------------------------------------------------
create or replace function public.get_recovery_email_status()
returns table (
  masked_email     text,
  is_verified      boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when r.recovery_email is null then null
      else left(r.recovery_email, 1) || '***@' ||
           substring(r.recovery_email from (position('@' in r.recovery_email) + 1))
    end as masked_email,
    r.recovery_email_confirmed_at is not null as is_verified
  from public.profiles r
  where r.id = auth.uid();
$$;

revoke all on function public.get_recovery_email_status() from public;
grant execute on function public.get_recovery_email_status() to authenticated;

-- ----------------------------------------------------------------------------
-- 4c. confirm_recovery_email()
--     Marks the caller's recovery email as verified. Called ONLY after the
--     user has clicked a recovery link delivered to the external address and
--     an authenticated session exists (native Supabase token verification has
--     already taken place). Sets recovery_email_confirmed_at = now().
-- ----------------------------------------------------------------------------
create or replace function public.confirm_recovery_email()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  update public.profiles
     set recovery_email_confirmed_at = now()
   where id = v_uid
     and recovery_email is not null;

  if not found then
    raise exception 'no recovery email to confirm';
  end if;

  perform public.log_audit_event('recovery_email_confirmed', 'profile', v_uid);
end;
$$;

revoke all on function public.confirm_recovery_email() from public;
grant execute on function public.confirm_recovery_email() to authenticated;

-- ----------------------------------------------------------------------------
-- 4d. clear_recovery_email()
--     Removes the caller's recovery email and its verification state.
-- ----------------------------------------------------------------------------
create or replace function public.clear_recovery_email()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  update public.profiles
     set recovery_email = null,
         recovery_email_confirmed_at = null
   where id = v_uid;

  if not found then
    return;
  end if;

  perform public.log_audit_event('recovery_email_cleared', 'profile', v_uid);
end;
$$;

revoke all on function public.clear_recovery_email() from public;
grant execute on function public.clear_recovery_email() to authenticated;

-- ----------------------------------------------------------------------------
-- Verification queries (read-only, safe to re-run)
-- ----------------------------------------------------------------------------
-- select column_name, is_nullable, data_type
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'profiles'
--    and column_name in ('recovery_email','recovery_email_confirmed_at')
--    order by ordinal_position;
--
-- select indexname, indexdef from pg_indexes
--   where tablename = 'profiles'
--     and indexname = 'profiles_recovery_email_unique_idx';
--
-- select proname, prosecdef, pg_get_function_arguments(oid) as args
--   from pg_proc
--   where proname in ('set_recovery_email','get_recovery_email_status',
--                     'confirm_recovery_email','clear_recovery_email')
--   order by proname;
--
-- select p.policyname, p.cmd from pg_policies p
--   where p.schemaname = 'public' and p.tablename = 'profiles'
--   order by p.policyname;   -- no new broad policies

commit;
