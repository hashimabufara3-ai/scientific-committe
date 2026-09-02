-- ============================================================================
-- Fix delete_summary() / delete_exam() ownership capture cast error.
--
-- CONFIRMED PRODUCTION BUG
-- ------------------------
-- Migration 20260903000000 rewrote the ownership-capture SELECT to fetch the
-- parent subject id alongside the owner check:
--
--   select author_id, subject_id into v_owned, v_subject_id
--
-- The target column `author_id` is UUID but the target variable `v_owned`
-- is BOOLEAN. PL/pgSQL's SELECT ... INTO applies an assignment cast from the
-- column type to the variable type, and casting a UUID value to BOOLEAN fails
-- with "invalid input syntax for type boolean: <uuid>" (SQLSTATE 22P02).
-- The failure occurs whenever the target row EXISTS (real author_id value);
-- for a missing row no cast happens and the function instead raises
-- "not found". This made delete_summary()/delete_exam() unusable for real
-- rows through the app/REST path.
--
-- FIX
-- ----
-- Restore the intended boolean ownership expression as the first selected
-- value (identical to the pre-20260903 functions and to delete_subject()):
--
--   select (author_id = v_actor), subject_id into v_owned, v_subject_id
--
-- Everything else in the 20260903 bodies is preserved byte-for-byte:
-- SECURITY DEFINER + search_path = public, require_contributor() gate,
-- profile-role lookup, ownership/admin/owner validation, parent subject
-- SELECT ... FOR UPDATE, child soft-delete (is_active = false, no hard
-- delete), active-child recount, parent deactivation on emptiness, same
-- error behavior, and the existing grants/signatures.
-- ============================================================================

-- Fix delete_summary(uuid): correct ownership capture.
create or replace function public.delete_summary(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid;
  v_role       public.user_role;
  v_owned      boolean;
  v_subject_id uuid;
  v_left       bigint;
begin
  v_actor := public.require_contributor();
  select role into v_role from public.profiles where id = auth.uid();

  -- Capture ownership + parent id BEFORE the target row changes state.
  select (author_id = v_actor), subject_id into v_owned, v_subject_id
    from public.summaries where id = p_id;
  if v_owned is null then
    raise exception 'not found';
  end if;
  if not v_owned
     and v_role not in ('admin'::public.user_role, 'owner'::public.user_role) then
    raise exception 'not allowed';
  end if;

  -- Serialize concurrent last-resource deletions on the SAME subject.
  if v_subject_id is not null then
    perform 1 from public.subjects
       where id = v_subject_id
       for update;
  end if;

  update public.summaries set is_active = false where id = p_id;

  -- Emptiness decision runs AFTER the target child is inactive and under the
  -- parent lock, so concurrent deletes cannot both see a remaining child and
  -- skip the parent cleanup.
  if v_subject_id is not null then
    select count(*) into v_left
      from public.summaries
     where subject_id = v_subject_id and is_active = true;
    if v_left = 0 then
      select count(*) into v_left
        from public.exam_files
       where subject_id = v_subject_id and is_active = true;
      if v_left = 0 then
        update public.subjects set is_active = false where id = v_subject_id;
      end if;
    end if;
  end if;
end;
$$;

revoke all on function public.delete_summary(uuid) from public;
grant execute on function public.delete_summary(uuid) to authenticated;

-- Fix delete_exam(uuid): correct ownership capture.
create or replace function public.delete_exam(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid;
  v_role       public.user_role;
  v_owned      boolean;
  v_subject_id uuid;
  v_left       bigint;
begin
  v_actor := public.require_contributor();
  select role into v_role from public.profiles where id = auth.uid();

  select (author_id = v_actor), subject_id into v_owned, v_subject_id
    from public.exam_files where id = p_id;
  if v_owned is null then
    raise exception 'not found';
  end if;
  if not v_owned
     and v_role not in ('admin'::public.user_role, 'owner'::public.user_role) then
    raise exception 'not allowed';
  end if;

  if v_subject_id is not null then
    perform 1 from public.subjects
       where id = v_subject_id
       for update;
  end if;

  update public.exam_files set is_active = false where id = p_id;

  if v_subject_id is not null then
    select count(*) into v_left
      from public.summaries
     where subject_id = v_subject_id and is_active = true;
    if v_left = 0 then
      select count(*) into v_left
        from public.exam_files
       where subject_id = v_subject_id and is_active = true;
      if v_left = 0 then
        update public.subjects set is_active = false where id = v_subject_id;
      end if;
    end if;
  end if;
end;
$$;

revoke all on function public.delete_exam(uuid) from public;
grant execute on function public.delete_exam(uuid) to authenticated;