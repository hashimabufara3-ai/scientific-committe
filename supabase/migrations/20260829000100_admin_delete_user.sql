-- ============================================================================
-- Account Members: authorize the deletion of a website account
-- ============================================================================
-- Purpose:
--   A website account is a Supabase Auth user (auth.users) with a 1:1
--   public.profiles row (profiles.id references auth.users.id on delete
--   cascade). Deleting it truly requires the Supabase Admin API
--   (auth.admin.deleteUser), which only a secure server action can invoke with
--   the service-role key. This RPC is NOT that caller — it is the authoritative
--   in-database authorization gate: it verifies that the acting admin/owner is
--   allowed to delete the target account before the server action proceeds.
--
--   It never touches auth.users (PostgreSQL functions cannot manage the auth
--   schema users table) and never performs a database delete. A caller cannot
--   bypass the target-protection rules by invoking this RPC directly because
--   the RPC itself raises on any unauthorized request. The server action is
--   secondary, defense-in-depth.
--
-- AUTHORIZATION (mirrors admin_delete_committee_member's model):
--   * Unauthenticated                                       -> not authenticated
--   * Non-admin / non-owner                                 -> insufficient privileges
--   * Target not found                                      -> user does not exist
--   * Anyone deleting the Owner account                     -> blocked
--   * Deleting your own account                             -> blocked
--   * Admin deleting another Admin                          -> blocked
--   * Admin deleting a Student/Contributor                  -> allowed
--   * Owner deleting a Student/Contributor/Admin            -> allowed
--
-- SECURITY: SECURITY DEFINER (runs as owner), search_path pinned to public,
-- least-privilege grants (REVOKE public / GRANT authenticated only), matching
-- the existing committee deletion functions. RLS, RBAC functions, and
-- committee-member deletion are NOT modified. No triggers are added.
-- ============================================================================

create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.user_role;
  v_trole public.user_role;
begin
  -- require_admin_role() raises 'not authenticated' (no auth.uid()) or
  -- 'insufficient privileges' for anyone below admin/owner, and returns the
  -- acting role so callers can enforce the admin-vs-owner distinction.
  v_actor := public.require_admin_role();

  select p.role into v_trole
    from public.profiles p
   where p.id = p_user_id;

  if v_trole is null then
    raise exception 'user does not exist';
  end if;

  -- Nobody may delete the Owner account (this also covers the Owner trying
  -- to delete their own account).
  if v_trole = 'owner'::public.user_role then
    raise exception 'the owner account cannot be deleted';
  end if;

  -- No one may delete their own account through account management.
  if p_user_id = auth.uid() then
    raise exception 'you cannot delete your own account';
  end if;

  -- An admin may not delete another admin account. Owner retains full control
  -- over Admin accounts (target here is necessarily student/contributor/admin
  -- because the owner target was already rejected above).
  if v_actor = 'admin'::public.user_role
     and v_trole = 'admin'::public.user_role then
    raise exception 'admin cannot delete another admin account';
  end if;
end;
$$;

-- Least-privilege grants (matching the committee deletion pattern).
revoke all on function public.admin_delete_user(uuid) from public;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Verification queries (read-only, safe to re-run)
-- ----------------------------------------------------------------------------
-- Only one definition for the uuid signature; the body authorizes and never
-- writes to auth.users:
--   select p.proname, pg_get_function_identity_arguments(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'admin_delete_user';
--   select position('require_admin_role' in pg_get_functiondef(p.oid)) > 0
--     from pg_proc p where p.proname = 'admin_delete_user';
-- Grants:
--   select has_function_privilege('authenticated', 'public.admin_delete_user(uuid)', 'execute');
-- ============================================================================
