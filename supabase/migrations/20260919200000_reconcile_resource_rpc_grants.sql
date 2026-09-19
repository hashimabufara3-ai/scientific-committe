-- ============================================================================
-- Incident #5 — Resource-RPC ACL grant reconciliation (hosted drift).
--
-- CONTEXT:
--   Hosted Supabase carries explicit EXECUTE grants for `anon` and
--   `service_role` on the five resource RPCs. The hardening migrations
--   (20260919120000 #4C and 20260919150000 #4D) intentionally only run
--   `REVOKE ... FROM PUBLIC`, which does NOT remove direct per-role grants:
--   PostgreSQL REVOKE-from-PUBLIC leaves explicit anon/service_role grants
--   fully intact. This migration closes that gap AFTER #4C/#4D.
--
-- INTENDED END STATE (matches the locally verified post-#4C/#4D ACL
--   {postgres, authenticated} on all five functions):
--     * authenticated  -> EXECUTE
--     * anon           -> DENIED
--     * service_role   -> DENIED
--     * PUBLIC         -> DENIED
--     * postgres/owner -> retained (owner privileges are implicit)
--
-- APPLICATION DEPENDENCY CHECK (read-only audit):
--   The application only ever invokes these five RPCs through the logged-in
--   contributor's authenticated client (`createClient()` in
--   app/[lang]/contribute/actions.ts at lines 352, 551, 631, 675, 768, 837,
--   866). Every `createAdminClient()` (service_role) in the codebase is used
--   exclusively for Storage I/O (finalizeStoredUpload / removeResource /
--   signed URLs) and for table SELECTs of existing storage_path rows — NEVER
--   for these five RPCs. `anon` has no legitimate call path either
--   (the functions require auth.uid() via require_contributor()).
--   => service_role and anon EXECUTE are NOT required by the current
--      application workflow.
--
-- THIS MIGRATION:
--   * Does NOT modify any function body, signature, SECURITY, or search_path.
--   * Explicitly REVOKEs anon + service_role from all five resource RPCs.
--   * Re-asserts PUBLIC denial (defense-in-depth parity with #4C/#4D; a no-op
--     where no PUBLIC grants exist).
--   * Re-asserts authenticated EXECUTE.
--   * Ends with a SELECT-only ACL verification (NOTICE); never mutates rows.
--
-- Identities are unambiguous: exactly ONE overload exists for each function
-- (verified on hosted and locally), so the arg-less name form resolves.
-- ============================================================================

-- 1. Revoke anon and service_role EXECUTE (the hosted drift).
revoke all on function public.create_summary from anon, service_role;
revoke all on function public.create_exam from anon, service_role;
revoke all on function public.create_subject_with_summary from anon, service_role;
revoke all on function public.update_summary from anon, service_role;
revoke all on function public.update_exam from anon, service_role;

-- 2. Re-assert PUBLIC is denied (parity with #4C/#4D; no-op if none).
revoke all on function public.create_summary from public;
revoke all on function public.create_exam from public;
revoke all on function public.create_subject_with_summary from public;
revoke all on function public.update_summary from public;
revoke all on function public.update_exam from public;

-- 3. Re-assert the intended grant: authenticated EXECUTE only.
grant execute on function public.create_summary to authenticated;
grant execute on function public.create_exam to authenticated;
grant execute on function public.create_subject_with_summary to authenticated;
grant execute on function public.update_summary to authenticated;
grant execute on function public.update_exam to authenticated;

-- 4. Verification (SELECT-only). Expected after apply:
--      create_exam                     | {postgres=X/postgres,authenticated=X/postgres}
--      create_subject_with_summary     | {postgres=X/postgres,authenticated=X/postgres}
--      create_summary                  | {postgres=X/postgres,authenticated=X/postgres}
--      update_exam                     | {postgres=X/postgres,authenticated=X/postgres}
--      update_summary                  | {postgres=X/postgres,authenticated=X/postgres}
do $$
declare
  r record;
begin
  for r in
    select p.proname,
           coalesce(p.proacl::text, '') as acl
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('create_summary','create_exam','create_subject_with_summary','update_summary','update_exam')
     order by p.proname
  loop
    raise notice 'resource RPC ACL %: %', r.proname, r.acl;
  end loop;
end $$;