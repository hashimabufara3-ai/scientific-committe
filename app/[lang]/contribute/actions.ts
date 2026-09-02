"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildSessionWithRole, getSessionUser } from "../../../lib/auth/authorize";
import { createAdminClient, createClient } from "../../../lib/auth/supabase-server";
import { checkRateLimit, LIMITERS } from "../../../lib/security/rate-limit";
import { removeResource, finalizeStoredUpload } from "../../../lib/content/storage";
import { subjectIsDuplicate } from "../../../lib/content/mock-contributor-data";
import type { ExamType, Semester } from "../../../lib/content/mock-contributor-data";

/* Server actions for the Resources/Summaries contributor workflow.

   These actions are the ONLY place metadata rows are created/updated/deleted.
   They receive METADATA plus the QUARANTINE storage path the browser uploaded
   directly to via a signed upload URL (see /api/resources/upload-auth). Each
   action finalizes the object server-side (validates the actual stored bytes —
   size + PDF magic bytes — then moves it to its canonical summaries/exams
   path) before any metadata row can reference it. The actions NEVER receive
   file bytes.

   Authorization is enforced twice:
     - Here, re-reading the actor's role from the database (getSessionRole).
     - Authoritatively in the SECURITY DEFINER functions (require_contributor()
       and the owner/admin checks), which cannot be bypassed via the client.

   Compensation: if an upload's metadata write fails, the finalized Storage
   object is removed so nothing is left orphaned. On soft delete of a subject,
   the storage objects under that subject are removed after the soft delete.

   The `lang` argument is used only to revalidate the correct localized paths.
*/

export type ResourceErrorKey =
  | "notAllowed"
  | "notFound"
  | "validation"
  | "notAuthenticated"
  | "uploadMissing"
  | "duplicate"
  | "generic";

export type SubjectActionResult = {
  ok: boolean;
  errorKey?: ResourceErrorKey;
  id?: string;
};

export type SummaryActionResult = {
  ok: boolean;
  errorKey?: ResourceErrorKey;
  id?: string;
};

export type ExamActionResult = {
  ok: boolean;
  errorKey?: ResourceErrorKey;
  id?: string;
};

function mapRpcError(message: string): ResourceErrorKey {
  const m = message.toLowerCase();
  if (m.includes("not authenticated")) return "notAuthenticated";
  if (m.includes("not found")) return "notFound";
  if (m.includes("not allowed") || m.includes("insufficient"))
    return "notAllowed";
  if (m.includes("required") || m.includes("invalid")) return "validation";
  return "generic";
}

async function authorizeContributor(lang: string) {
  const au = await getSessionUser();
  if (!au) redirect(`/${lang}/auth/sign-in`);

  const { user, supabase } = au;

  /* The two authorization reads that depend only on the user id run in
     PARALLEL:
       - the database profile (role + must_change_password);
       - the Upstash adminAction rate limit.
     Both are awaited together BEFORE the caller may reach any mutation; a
     failed/absent profile leaves role null (rejected below) and a rejected rate
     limit returns null, so the delete RPC can never run early or unauthorized. */
  const profilePromise = supabase
    .from("profiles")
    .select("role, must_change_password")
    .eq("id", user.id)
    .maybeSingle();
  const ratePromise = checkRateLimit(
    LIMITERS.adminAction,
    `resources:action:${user.id}`
  );

  const [{ data: profile }, { success: allowed }] = await Promise.all([
    profilePromise,
    ratePromise,
  ]);

  const session = buildSessionWithRole(user, profile);

  /* The proxy no longer runs the must_change_password check on Server Action
     POSTs (it skips its Supabase layers for requests carrying Next-Action), so
     the action enforces it itself — identical to the proxy's navigation rule:
     a profile flagged for a forced password change cannot run any contributor
     mutation. */
  if (session.mustChangePassword) {
    redirect(`/${lang}/auth/change-password`);
  }
  if (
    session.role !== "contributor" &&
    session.role !== "admin" &&
    session.role !== "owner"
  ) {
    return null;
  }
  return allowed ? session : null;
}

function revalidateResources(lang: string) {
  /* The public /[lang]/summaries listing is fully dynamic (force-dynamic) and
     reads the current active catalog straight from the database on every
     request, so no revalidation is needed for it — there is no ISR cache to
     poison or stale data to clear. The contributor workspace is also
     force-dynamic; the path revalidate below is a harmless best-effort nudge
     for the client Router Cache after a mutation. */
  revalidatePath(`/${lang}/contribute`);
}

/* Run `mapper` over items with a small, bounded concurrency so a subject with
   many stored objects is cleaned up concurrently without risking an
   uncontrolled burst of parallel HTTP/Storage requests. Resolves once every
   task has settled; callers decide how to treat individual failures. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  }
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

/* Authoritative duplicate-name check. Only ACTIVE subjects block creation:
   soft-deleted materials (is_active = false) are intentionally ignored so a
   contributor can re-create a subject with the same name after deleting it.
   Matching mirrors the client's normalizeTitle() rules (trim, case-fold,
   collapse inner whitespace). This is a SECURITY DEFINER-guarded read via the
   authenticated server client — the DB has no unique index on subjects.title
   (soft delete means multiple rows may reasonably share a name), so this
   check is the enforcement point.

   The result distinguishes three cases so a database/query failure is never
   mistaken for "no duplicate" (which would silently allow a duplicate) nor
   for "duplicate" (which would falsely block a valid new subject):
     - "duplicate" : an ACTIVE subject matches the name.
     - "ok"        : no active match.
     - "error"     : the query itself failed (caller must surface a real
                     internal error, not a duplicate verdict).
   An empty result set is "ok", not "error" — supabase-js returns data: [] on
   success and data: null only when the query errored. */
type DuplicateCheck = "duplicate" | "ok" | "error";

async function findActiveDuplicateSubject(
  title: string
): Promise<DuplicateCheck> {
  const supabase = await createClient();
  const { data: activeSubjects, error } = await supabase
    .from("subjects")
    .select("title, title_ar")
    .eq("is_active", true);
  if (error) return "error";
  return subjectIsDuplicate(activeSubjects ?? [], title) ? "duplicate" : "ok";
}

/* ---- Subjects ------------------------------------------------------------ */

export type CreateNewMaterialInput = {
  /* New material localized names (the subject): English and Arabic, both
     required. Never stored as one field. */
  title: string;
  titleAr?: string;
  summary: {
    title: string;
    source: "upload" | "content";
    content?: string;
    videos: string[];
    /* Present only when source === "upload" (already uploaded to Storage). */
    storagePath?: string;
    fileName?: string;
    mimeType?: string;
    fileSize?: number;
  };
  /* Optional previous exam attached during new-material creation. */
  exam?: {
    type: ExamType;
    year?: string;
    semester?: Semester | "";
    storagePath: string;
    fileName: string;
    mimeType?: string;
    fileSize?: number;
  };
};

/* Create a NEW material (subject) together with its first summary and an
   optional previous exam in ONE atomic SECURITY DEFINER RPC. The subject,
   summary and exam rows are inserted inside a single database transaction, so
   the public (force-dynamic) catalog can never observe the subject before the
   whole creation has committed. A rejected duplicate or any RPC failure rolls
   back entirely -> no publicly visible incomplete subject is ever left behind.

   Uploads to Storage happen on the client BEFORE this action (the RPC needs
   the object paths). If this action then rejects, the just-uploaded objects
   are removed as compensation so nothing is orphaned. The authoritative
   active-only duplicate check (findActiveDuplicateSubject) runs here — client
   state is never trusted. */
export async function createNewMaterialAction(
  lang: string,
  input: CreateNewMaterialInput
): Promise<SubjectActionResult> {
  const session = await authorizeContributor(lang);
  if (!session) return { ok: false, errorKey: "notAllowed" };

  const title = input.title.trim();
  const titleAr = (input.titleAr ?? "").trim();
  const summaryTitle = input.summary.title.trim();
  if (!title || !titleAr || !summaryTitle)
    return { ok: false, errorKey: "validation" };
  if (input.summary.source === "upload" && !input.summary.storagePath) {
    return { ok: false, errorKey: "uploadMissing" };
  }
  if (input.summary.source === "content" && !input.summary.content?.trim()) {
    return { ok: false, errorKey: "validation" };
  }
  if (input.exam && (!input.exam.storagePath || !input.exam.fileName)) {
    return { ok: false, errorKey: "uploadMissing" };
  }

  /* Best-effort compensation of quarantine objects uploaded by the client
     when the transaction fails BEFORE any finalize happens. After a finalize
     succeeds the object lives at its final path, which the RPC-failure
     compensation below removes instead. */
  const compensateQuarantine = async () => {
    const paths = [
      input.summary.source === "upload" ? input.summary.storagePath : null,
      input.exam?.storagePath ?? null,
    ].filter((p): p is string => Boolean(p));
    for (const path of paths) {
      try {
        await removeResource(path);
      } catch {
        /* cleanup best-effort */
      }
    }
  };

  const supabase = await createClient();
  const duplicateCheck = await findActiveDuplicateSubject(title);
  if (duplicateCheck === "duplicate") {
    await compensateQuarantine();
    return { ok: false, errorKey: "duplicate" };
  }
  if (duplicateCheck === "error") {
    await compensateQuarantine();
    return { ok: false, errorKey: "generic" };
  }

  /* Finalize (validate + move) any directly-uploaded objects. Each helper
     removes its quarantine object on failure; on the summary's failure we also
     remove any pending exam quarantine. The authoritative server-side size is
     taken from the stored object. */
  let summaryFinal: { finalPath: string; size: number } | null = null;
  if (input.summary.source === "upload" && input.summary.storagePath) {
    const finalized = await finalizeStoredUpload({
      quarantinePath: input.summary.storagePath,
      userId: session.user.id,
      kind: "summary",
    });
    if (!finalized.ok) {
      await compensateQuarantine();
      return { ok: false, errorKey: "validation" };
    }
    summaryFinal = { finalPath: finalized.finalPath, size: finalized.size };
  }

  let examFinal: { finalPath: string; size: number } | null = null;
  if (input.exam?.storagePath) {
    const finalized = await finalizeStoredUpload({
      quarantinePath: input.exam.storagePath,
      userId: session.user.id,
      kind: "exam",
    });
    if (!finalized.ok) {
      if (summaryFinal) {
        try {
          await removeResource(summaryFinal.finalPath);
        } catch {
          /* cleanup best-effort */
        }
      }
      return { ok: false, errorKey: "validation" };
    }
    examFinal = { finalPath: finalized.finalPath, size: finalized.size };
  }

  const { data: id, error } = await supabase.rpc("create_subject_with_summary", {
    p_title: title,
    p_title_ar: titleAr,
    p_summary_title: summaryTitle,
    p_summary_source: input.summary.source,
    p_summary_content:
      input.summary.source === "content" ? input.summary.content?.trim() : null,
    p_summary_videos:
      input.summary.videos?.filter((v) => v.trim().length > 0) ?? [],
    p_summary_storage_path:
      input.summary.source === "upload" ? summaryFinal?.finalPath ?? null : null,
    p_summary_file_name:
      input.summary.source === "upload" ? input.summary.fileName : null,
    p_summary_mime_type:
      input.summary.source === "upload" ? "application/pdf" : null,
    p_summary_file_size:
      input.summary.source === "upload" ? summaryFinal?.size ?? null : null,
    p_exam_type: input.exam?.type ?? null,
    p_exam_year: input.exam?.year || null,
    p_exam_semester: input.exam?.semester || null,
    p_exam_storage_path: examFinal?.finalPath ?? null,
    p_exam_file_name: input.exam?.fileName ?? null,
    p_exam_mime_type: input.exam ? "application/pdf" : null,
    p_exam_file_size: examFinal?.size ?? null,
  });

  if (error) {
    /* Compensation for finalized objects already moved out of quarantine. */
    const moved = [summaryFinal?.finalPath, examFinal?.finalPath].filter(
      (p): p is string => Boolean(p)
    );
    for (const path of moved) {
      try {
        await removeResource(path);
      } catch {
        /* cleanup best-effort */
      }
    }
    return { ok: false, errorKey: mapRpcError(error.message) };
  }

  revalidateResources(lang);
  revalidatePath(`/${lang}/summaries/${id}`);
  return { ok: true, id: typeof id === "string" ? id : String(id) };
}

export async function updateSubjectAction(
  lang: string,
  id: string,
  title: string,
  titleAr?: string
): Promise<SubjectActionResult> {
  const session = await authorizeContributor(lang);
  if (!session) return { ok: false, errorKey: "notAllowed" };
  const trimmed = title.trim();
  const trimmedAr = (titleAr ?? "").trim();
  if (!trimmed || !trimmedAr) return { ok: false, errorKey: "validation" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_subject", {
    p_id: id,
    p_title: trimmed,
    p_title_ar: trimmedAr,
  });
  if (error) return { ok: false, errorKey: mapRpcError(error.message) };

  revalidateResources(lang);
  revalidatePath(`/${lang}/summaries/${id}`);
  return { ok: true };
}

/* Soft delete a subject, then remove the storage objects of its summaries and
   exams as compensation. The SECURITY DEFINER RPC collects the child storage
   paths AND performs the authoritative soft delete in ONE round trip, so the
   action needs a single database call (path queries + delete used to be three
   sequential calls). Storage cleanup stays best-effort and runs AFTER the DB
   delete, exactly as before. */
export async function deleteSubjectAction(
  lang: string,
  id: string
): Promise<SubjectActionResult> {
  const session = await authorizeContributor(lang);
  if (!session) return { ok: false, errorKey: "notAllowed" };

  const supabase = await createClient();
  const { data: paths, error } = await supabase.rpc(
    "delete_subject_with_storage",
    { p_id: id }
  );
  if (error) return { ok: false, errorKey: mapRpcError(error.message) };

  /* Best-effort compensation: remove each stored object with a small bounded
     concurrency (safe for subjects with many files). DB deletion already
     succeeded and is authoritative; a failed object removal only leaves an
     orphan for cleanup and never undoes it. */
  const stored = (paths ?? [])
    .map((row) => row.storage_path)
    .filter((p): p is string => Boolean(p));
  await mapLimit(stored, 4, async (path) => {
    try {
      await removeResource(path);
    } catch {
      /* orphaned object left for manual cleanup — safe to continue */
    }
  });

  revalidateResources(lang);
  revalidatePath(`/${lang}/summaries/${id}`);
  return { ok: true };
}

/* ---- Summaries ----------------------------------------------------------- */

export type CreateSummaryInput = {
  subjectId: string;
  title: string;
  source: "upload" | "content";
  content?: string;
  videos: string[];
  /* Present only when a NEW file was uploaded for this summary. */
  storagePath?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
};

export async function createSummaryAction(
  lang: string,
  input: CreateSummaryInput
): Promise<SummaryActionResult> {
  const session = await authorizeContributor(lang);
  if (!session) return { ok: false, errorKey: "notAllowed" };

  const title = input.title.trim();
  if (!title) return { ok: false, errorKey: "validation" };
  if (input.source === "upload" && !input.storagePath) {
    return { ok: false, errorKey: "uploadMissing" };
  }
  if (input.source === "content" && !input.content?.trim()) {
    return { ok: false, errorKey: "validation" };
  }

  const supabase = await createClient();

  /* The browser uploaded DIRECTLY to Storage into its own quarantine path.
     Finalize = validate the actual stored bytes (size + PDF magic bytes) with
     the service-role client, then move the object to its canonical path. Only
     the final path is ever written to metadata; the quarantine object is
     removed here on any validation failure. */
  let storedPath: string | null = null;
  let storedSize: number | null = null;
  if (input.source === "upload" && input.storagePath) {
    const finalized = await finalizeStoredUpload({
      quarantinePath: input.storagePath,
      userId: session.user.id,
      kind: "summary",
    });
    if (!finalized.ok) return { ok: false, errorKey: "validation" };
    storedPath = finalized.finalPath;
    storedSize = finalized.size;
  }

  const { data: id, error } = await supabase.rpc("create_summary", {
    p_subject_id: input.subjectId,
    p_title: title,
    p_source: input.source,
    p_content: input.source === "content" ? input.content?.trim() : null,
    p_videos: input.videos?.filter((v) => v.trim().length > 0) ?? [],
    p_storage_path: input.source === "upload" ? storedPath : null,
    p_file_name: input.source === "upload" ? input.fileName : null,
    p_mime_type: input.source === "upload" ? "application/pdf" : null,
    p_file_size: input.source === "upload" ? storedSize : null,
  });

  if (error) {
    /* Compensation: remove the finalized object so nothing is orphaned. */
    if (storedPath) {
      try {
        await removeResource(storedPath);
      } catch {
        /* cleanup best-effort */
      }
    }
    return { ok: false, errorKey: mapRpcError(error.message) };
  }

  revalidateResources(lang);
  revalidatePath(`/${lang}/summaries/${input.subjectId}`);
  return { ok: true, id: typeof id === "string" ? id : String(id) };
}

export type UpdateSummaryInput = {
  subjectId: string;
  id: string;
  title: string;
  source: "upload" | "content";
  content?: string;
  videos: string[];
  /* Present only when the file CHANGED (a new upload). When absent, the
     existing uploaded file metadata is preserved. */
  storagePath?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
};

export async function updateSummaryAction(
  lang: string,
  input: UpdateSummaryInput
): Promise<SummaryActionResult> {
  const session = await authorizeContributor(lang);
  if (!session) return { ok: false, errorKey: "notAllowed" };

  const title = input.title.trim();
  if (!title) return { ok: false, errorKey: "validation" };
  if (input.source === "upload" && !input.storagePath) {
    return { ok: false, errorKey: "uploadMissing" };
  }
  if (input.source === "content" && !input.content?.trim()) {
    return { ok: false, errorKey: "validation" };
  }

  const supabase = await createClient();

  if (input.source === "upload" && input.storagePath) {
    /* New file for this summary (already uploaded directly to Storage into the
       caller's quarantine path): finalize = validate the actual stored bytes,
       move it to its canonical path. The OLD stored object is removed only
       after a successful metadata update. */
    const finalized = await finalizeStoredUpload({
      quarantinePath: input.storagePath,
      userId: session.user.id,
      kind: "summary",
    });
    if (!finalized.ok) return { ok: false, errorKey: "validation" };
    const newPath = finalized.finalPath;

    const admin = createAdminClient();
    const { data: current } = await admin
      .from("summaries")
      .select("storage_path")
      .eq("id", input.id)
      .single();
    const { error } = await supabase.rpc("update_summary", {
      p_id: input.id,
      p_title: title,
      p_source: input.source,
      p_content: null,
      p_videos: input.videos?.filter((v) => v.trim().length > 0) ?? [],
      p_storage_path: newPath,
      p_file_name: input.fileName,
      p_mime_type: "application/pdf",
      p_file_size: finalized.size,
    });
    if (error) {
      try {
        await removeResource(newPath);
      } catch {
        /* best-effort */
      }
      return { ok: false, errorKey: mapRpcError(error.message) };
    }
    /* Best-effort removal of the superseded object. */
    if (current?.storage_path && current.storage_path !== newPath) {
      try {
        await removeResource(current.storage_path);
      } catch {
        /* best-effort */
      }
    }
  } else {
    const { error } = await supabase.rpc("update_summary", {
      p_id: input.id,
      p_title: title,
      p_source: input.source,
      p_content: input.source === "content" ? input.content?.trim() : null,
      p_videos: input.videos?.filter((v) => v.trim().length > 0) ?? [],
    });
    if (error) return { ok: false, errorKey: mapRpcError(error.message) };
  }

  revalidateResources(lang);
  revalidatePath(`/${lang}/summaries/${input.subjectId}`);
  return { ok: true };
}

export async function deleteSummaryAction(
  lang: string,
  subjectId: string,
  id: string
): Promise<SummaryActionResult> {
  const session = await authorizeContributor(lang);
  if (!session) return { ok: false, errorKey: "notAllowed" };

  const admin = createAdminClient();
  const { data: current } = await admin
    .from("summaries")
    .select("storage_path")
    .eq("id", id)
    .single();

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_summary", { p_id: id });
  if (error) return { ok: false, errorKey: mapRpcError(error.message) };

  if (current?.storage_path) {
    try {
      await removeResource(current.storage_path);
    } catch {
      /* best-effort */
    }
  }

  revalidateResources(lang);
  revalidatePath(`/${lang}/summaries/${subjectId}`);
  return { ok: true };
}

/* ---- Previous exams ------------------------------------------------------ */

export type CreateExamInput = {
  subjectId: string;
  type: ExamType;
  year?: string;
  semester?: Semester | "";
  storagePath: string;
  fileName: string;
  mimeType?: string;
  fileSize?: number;
};

export async function createExamAction(
  lang: string,
  input: CreateExamInput
): Promise<ExamActionResult> {
  const session = await authorizeContributor(lang);
  if (!session) return { ok: false, errorKey: "notAllowed" };
  if (!input.storagePath || !input.fileName) {
    return { ok: false, errorKey: "uploadMissing" };
  }

  const supabase = await createClient();

  /* Finalize the directly-uploaded exam: validate the actual stored bytes and
     move it to its canonical path before metadata references it. */
  const finalized = await finalizeStoredUpload({
    quarantinePath: input.storagePath,
    userId: session.user.id,
    kind: "exam",
  });
  if (!finalized.ok) return { ok: false, errorKey: "validation" };

  const { data: id, error } = await supabase.rpc("create_exam", {
    p_subject_id: input.subjectId,
    p_type: input.type,
    p_year: input.year?.trim() || null,
    p_semester: input.semester || null,
    p_storage_path: finalized.finalPath,
    p_file_name: input.fileName,
    p_mime_type: "application/pdf",
    p_file_size: finalized.size,
  });

  if (error) {
    try {
      await removeResource(finalized.finalPath);
    } catch {
      /* cleanup best-effort */
    }
    return { ok: false, errorKey: mapRpcError(error.message) };
  }

  revalidateResources(lang);
  revalidatePath(`/${lang}/summaries/${input.subjectId}`);
  return { ok: true, id: typeof id === "string" ? id : String(id) };
}

export type UpdateExamInput = {
  subjectId: string;
  id: string;
  type: ExamType;
  year?: string;
  semester?: Semester | "";
  /* Present only when the file CHANGED (a new upload). When absent, the
     existing exam file is preserved. */
  storagePath?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
};

export async function updateExamAction(
  lang: string,
  input: UpdateExamInput
): Promise<ExamActionResult> {
  const session = await authorizeContributor(lang);
  if (!session) return { ok: false, errorKey: "notAllowed" };

  const supabase = await createClient();

  if (input.storagePath) {
    /* New file for this exam (already uploaded directly to Storage into the
       caller's quarantine path): finalize = validate the actual stored bytes,
       move it to its canonical path. The OLD stored object is removed only
       after a successful metadata update. */
    const finalized = await finalizeStoredUpload({
      quarantinePath: input.storagePath,
      userId: session.user.id,
      kind: "exam",
    });
    if (!finalized.ok) return { ok: false, errorKey: "validation" };
    const newPath = finalized.finalPath;

    const admin = createAdminClient();
    const { data: current } = await admin
      .from("exam_files")
      .select("storage_path")
      .eq("id", input.id)
      .single();
    const { error } = await supabase.rpc("update_exam", {
      p_id: input.id,
      p_type: input.type,
      p_year: input.year?.trim() || null,
      p_semester: input.semester || null,
      p_storage_path: newPath,
      p_file_name: input.fileName,
      p_mime_type: "application/pdf",
      p_file_size: finalized.size,
    });
    if (error) {
      /* Compensation for the failed update: remove the NEW (finalized) object
         so we do not leak it, and keep the old object intact. */
      try {
        await removeResource(newPath);
      } catch {
        /* best-effort */
      }
      return { ok: false, errorKey: mapRpcError(error.message) };
    }
    if (current?.storage_path && current.storage_path !== newPath) {
      try {
        await removeResource(current.storage_path);
      } catch {
        /* best-effort */
      }
    }
  } else {
    /* No new upload — preserve the existing file. */
    const { error } = await supabase.rpc("update_exam", {
      p_id: input.id,
      p_type: input.type,
      p_year: input.year?.trim() || null,
      p_semester: input.semester || null,
    });
    if (error) return { ok: false, errorKey: mapRpcError(error.message) };
  }

  revalidateResources(lang);
  revalidatePath(`/${lang}/summaries/${input.subjectId}`);
  return { ok: true };
}

export async function deleteExamAction(
  lang: string,
  subjectId: string,
  id: string
): Promise<ExamActionResult> {
  const session = await authorizeContributor(lang);
  if (!session) return { ok: false, errorKey: "notAllowed" };

  const admin = createAdminClient();
  const { data: current } = await admin
    .from("exam_files")
    .select("storage_path")
    .eq("id", id)
    .single();

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_exam", { p_id: id });
  if (error) return { ok: false, errorKey: mapRpcError(error.message) };

  if (current?.storage_path) {
    try {
      await removeResource(current.storage_path);
    } catch {
      /* best-effort */
    }
  }

  revalidateResources(lang);
  revalidatePath(`/${lang}/summaries/${subjectId}`);
  return { ok: true };
}
