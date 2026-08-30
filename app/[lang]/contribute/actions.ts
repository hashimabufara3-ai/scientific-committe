"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionRole } from "../../../lib/auth/authorize";
import { createAdminClient, createClient } from "../../../lib/auth/supabase-server";
import { checkRateLimit, LIMITERS } from "../../../lib/security/rate-limit";
import { removeResource } from "../../../lib/content/storage";
import { subjectIsDuplicate } from "../../../lib/content/mock-contributor-data";
import type { ExamType, Semester } from "../../../lib/content/mock-contributor-data";

/* Server actions for the Resources/Summaries contributor workflow.

   These actions are the ONLY place metadata rows are created/updated/deleted.
   They receive METADATA plus a storage path (for uploads the path was produced
   by the /api/resources/upload route from raw bytes). They NEVER receive file
   bytes.

   Authorization is enforced twice:
     - Here, re-reading the actor's role from the database (getSessionRole).
     - Authoritatively in the SECURITY DEFINER functions (require_contributor()
       and the owner/admin checks), which cannot be bypassed via the client.

   Compensation: if an upload's metadata write fails, the just-uploaded Storage
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
  const session = await getSessionRole();
  if (!session) redirect(`/${lang}/auth/sign-in`);
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
  const { success: allowed } = await checkRateLimit(
    LIMITERS.adminAction,
    `resources:action:${session.user.id}`
  );
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

export async function createSubjectAction(
  lang: string,
  title: string
): Promise<SubjectActionResult> {
  const session = await authorizeContributor(lang);
  if (!session) return { ok: false, errorKey: "notAllowed" };

  const trimmed = title.trim();
  if (!trimmed) return { ok: false, errorKey: "validation" };

  const supabase = await createClient();
  const duplicateCheck = await findActiveDuplicateSubject(trimmed);
  if (duplicateCheck === "duplicate") {
    return { ok: false, errorKey: "duplicate" };
  }
  if (duplicateCheck === "error") {
    /* A DB/query failure must surface as a real internal error, not a false
       "duplicate" — and not silently allow a duplicate. */
    return { ok: false, errorKey: "generic" };
  }

  const { data: id, error } = await supabase.rpc("create_subject", {
    p_title: trimmed,
  });
  if (error) return { ok: false, errorKey: mapRpcError(error.message) };

  revalidateResources(lang);
  return { ok: true, id: typeof id === "string" ? id : String(id) };
}

export type CreateNewMaterialInput = {
  /* New material name (the subject). */
  title: string;
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
  const summaryTitle = input.summary.title.trim();
  if (!title || !summaryTitle) return { ok: false, errorKey: "validation" };
  if (input.summary.source === "upload" && !input.summary.storagePath) {
    return { ok: false, errorKey: "uploadMissing" };
  }
  if (input.summary.source === "content" && !input.summary.content?.trim()) {
    return { ok: false, errorKey: "validation" };
  }
  if (input.exam && (!input.exam.storagePath || !input.exam.fileName)) {
    return { ok: false, errorKey: "uploadMissing" };
  }

  /* Best-effort compensation of already-uploaded objects when the transaction
     did not happen (duplicate verdict / RPC failure). */
  const compensateUploads = async () => {
    if (input.summary.source === "upload" && input.summary.storagePath) {
      try {
        await removeResource(input.summary.storagePath);
      } catch {
        /* cleanup best-effort */
      }
    }
    if (input.exam?.storagePath) {
      try {
        await removeResource(input.exam.storagePath);
      } catch {
        /* cleanup best-effort */
      }
    }
  };

  const supabase = await createClient();
  const duplicateCheck = await findActiveDuplicateSubject(title);
  if (duplicateCheck === "duplicate") {
    await compensateUploads();
    return { ok: false, errorKey: "duplicate" };
  }
  if (duplicateCheck === "error") {
    await compensateUploads();
    return { ok: false, errorKey: "generic" };
  }

  const { data: id, error } = await supabase.rpc("create_subject_with_summary", {
    p_title: title,
    p_summary_title: summaryTitle,
    p_summary_source: input.summary.source,
    p_summary_content:
      input.summary.source === "content" ? input.summary.content?.trim() : null,
    p_summary_videos:
      input.summary.videos?.filter((v) => v.trim().length > 0) ?? [],
    p_summary_storage_path:
      input.summary.source === "upload" ? input.summary.storagePath : null,
    p_summary_file_name:
      input.summary.source === "upload" ? input.summary.fileName : null,
    p_summary_mime_type:
      input.summary.source === "upload" ? input.summary.mimeType : null,
    p_summary_file_size:
      input.summary.source === "upload" ? input.summary.fileSize : null,
    p_exam_type: input.exam?.type ?? null,
    p_exam_year: input.exam?.year || null,
    p_exam_semester: input.exam?.semester || null,
    p_exam_storage_path: input.exam?.storagePath ?? null,
    p_exam_file_name: input.exam?.fileName ?? null,
    p_exam_mime_type: input.exam?.mimeType ?? null,
    p_exam_file_size: input.exam?.fileSize ?? null,
  });

  if (error) {
    await compensateUploads();
    return { ok: false, errorKey: mapRpcError(error.message) };
  }

  revalidateResources(lang);
  revalidatePath(`/${lang}/summaries/${id}`);
  return { ok: true, id: typeof id === "string" ? id : String(id) };
}

export async function updateSubjectAction(
  lang: string,
  id: string,
  title: string
): Promise<SubjectActionResult> {
  const session = await authorizeContributor(lang);
  if (!session) return { ok: false, errorKey: "notAllowed" };
  const trimmed = title.trim();
  if (!trimmed) return { ok: false, errorKey: "validation" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_subject", {
    p_id: id,
    p_title: trimmed,
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
  const { data: id, error } = await supabase.rpc("create_summary", {
    p_subject_id: input.subjectId,
    p_title: title,
    p_source: input.source,
    p_content: input.source === "content" ? input.content?.trim() : null,
    p_videos: input.videos?.filter((v) => v.trim().length > 0) ?? [],
    p_storage_path: input.source === "upload" ? input.storagePath : null,
    p_file_name: input.source === "upload" ? input.fileName : null,
    p_mime_type: input.source === "upload" ? input.mimeType : null,
    p_file_size: input.source === "upload" ? input.fileSize : null,
  });

  if (error) {
    /* Compensation: remove the just-uploaded object so nothing is orphaned. */
    if (input.storagePath) {
      try {
        await removeResource(input.storagePath);
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
    /* New file for this summary: remove the OLD stored object after a
       successful metadata update, as compensation for the swap. */
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
      p_storage_path: input.storagePath,
      p_file_name: input.fileName,
      p_mime_type: input.mimeType,
      p_file_size: input.fileSize,
    });
    if (error) {
      try {
        await removeResource(input.storagePath);
      } catch {
        /* best-effort */
      }
      return { ok: false, errorKey: mapRpcError(error.message) };
    }
    /* Best-effort removal of the superseded object. */
    if (current?.storage_path && current.storage_path !== input.storagePath) {
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
  const { data: id, error } = await supabase.rpc("create_exam", {
    p_subject_id: input.subjectId,
    p_type: input.type,
    p_year: input.year?.trim() || null,
    p_semester: input.semester || null,
    p_storage_path: input.storagePath,
    p_file_name: input.fileName,
    p_mime_type: input.mimeType,
    p_file_size: input.fileSize,
  });

  if (error) {
    if (input.storagePath) {
      try {
        await removeResource(input.storagePath);
      } catch {
        /* best-effort */
      }
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
    /* New file for this exam: remove the OLD stored object after a successful
       metadata update, as compensation for the swap. */
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
      p_storage_path: input.storagePath,
      p_file_name: input.fileName,
      p_mime_type: input.mimeType,
      p_file_size: input.fileSize,
    });
    if (error) {
      /* Compensation for the failed update: remove the NEW object so we do not
         leak it, and keep the old object intact (the row still references it). */
      try {
        await removeResource(input.storagePath);
      } catch {
        /* best-effort */
      }
      return { ok: false, errorKey: mapRpcError(error.message) };
    }
    if (current?.storage_path && current.storage_path !== input.storagePath) {
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
