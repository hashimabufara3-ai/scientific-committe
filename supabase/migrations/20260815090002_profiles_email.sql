-- ============================================================================
-- Phase A: expose a displayable email on profiles.
--
-- profiles is the RLS-managed identity table the client may read; auth.users
-- is not readable by the anon/authenticated roles, so admins cannot search
-- users by email without a service_role key. We mirror auth.users.email into
-- profiles (backfilling existing rows and extending the profile-creation
-- trigger). RLS already confines email visibility: students see only their
-- own row; admin/owner see all rows via the admin read policy.
-- ============================================================================

alter table public.profiles add column if not exists email text;

-- Backfill existing profiles from auth.users (this migration runs as the
-- table owner, so RLS does not apply). The trigger only fires for rows
-- created after this migration.
update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id
   and (p.email is null or p.email = '');

-- auth.users.email is unique; mirror that here for the profiles table.
create unique index if not exists profiles_email_unique_idx
  on public.profiles (email)
  where email is not null;

-- Profile creation now also stores the email. All other behaviour (security
-- definer, pinned search_path, role never taken from client metadata) is
-- unchanged from the original trigger.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email
  );
  return new;
end;
$$;

-- Sanity check (read-only, safe to re-run):
-- select id, email, full_name, role from public.profiles order by created_at;
