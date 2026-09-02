-- ============================================================================
-- Contributor: soft-delete a subject when its LAST active resource is deleted.
--
-- CONFIRMED PRODUCTION BUG
-- ------------------------
-- createNewMaterialAction() creates the subject + first summary (+ optional
-- exam) atomically and correctly. The regression happens AFTER deleting a
-- subject's LAST active summary or exam: the child is soft-deleted
-- (is_active = false) but the parent subjects row stays is_active = true.
-- getSubjects() intentionally filters out subjects with zero active summaries
-- AND zero active exams, so that parent becomes an active-but-empty "orphan"
-- that permanently disappears from the Contributor catalog and can never be
-- re-created under the same title (active duplicate detection), producing
-- repeated hidden subject rows.
--
-- FIX
-- ----
-- delete_summary() and delete_exam() now soft-delete the parent subjects row
-- too, but ONLY when, after the target child is deactivated, the subject holds
-- zero active summaries AND zero active exams. The emptiness decision is made
-- in the SAME transaction as the child deletion (a SECURITY DEFINER function
-- body commits atomically), so there is never an intermediate committed state
-- where the child is gone but the parent-cleanup has not happened.
--
-- RACE SAFETY
-- -----------
-- Concurrent last-child deletions of the same subject could both read "a
-- child still remains" and both skip the cleanup. Both delete functions now
-- lock the parent subjects row (SELECT ... FOR UPDATE) before re-checking the
-- active-child counts. Every child deletion touches exactly ONE subject, so a
-- delete serializes per-subject: a second deleter of the same subject waits on
-- the parent lock, then re-evaluates atomically against the committed state.
-- No broad/table locking is introduced, and no lock-ordering deadlock is
-- possible (each delete locks exactly one subject row and one child row, all
-- released at commit).
--
-- Unchanged: authorization (require_contributor + ownership/admin/owner),
-- soft-delete semantics (is_active = false, rows are never hard-deleted),
-- function signatures, grants, SECURITY DEFINER, search_path, and the child
-- soft-delete behavior itself.
-- ============================================================================

-- Soft delete a summary. Owner (or admin/owner). Soft-deletes the parent
-- subject when that was the subject's last remaining active resource.
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
  select author_id, subject_id into v_owned, v_subject_id
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

-- Soft delete an exam file. Owner (or admin/owner). Soft-deletes the parent
-- subject when that was the subject's last remaining active resource.
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

  select author_id, subject_id into v_owned, v_subject_id
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
