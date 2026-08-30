"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionRole } from "../../../lib/auth/authorize";
import { createAdminClient, createClient } from "../../../lib/auth/supabase-server";
import { checkRateLimit, LIMITERS } from "../../../lib/security/rate-limit";
import { removeResource } from "../../../lib/content/storage";
import { normalizeTitle } from "../../../lib/content/mock-contributor-data";
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

/* Authoritative duplicate-name check. Only ACTIVE subjects block creation:
   soft-deleted materials (is_active = false) are intentionally ignored so a
   contributor can re-create a subject with the same name after deleting it.
   Matching mirrors the client's normalizeTitle() rules (trim, case-fold,
   collapse inner whitespace). This is a SECURITY DEFINER-guarded read via the
   authenticated server client — the DB has no unique index on subjects.title
   (soft delete means multiple rows may reasonably share a name), so this
   check is the enforcement point; it must agree with the client check. */
async function findActiveDuplicateSubject(
  title: string
): Promise<boolean> {
  const supabase = await createClient();
  const { data: activeSubjects } = await supabase
    .from("subjects")
    .select("title, title_ar")
    .eq("is_active", true);
  if (!activeSubjects) return false;
  const normalized = normalizeTitle(title);
  return activeSubjects.some((s) => {
    if (normalizeTitle(s.title) === normalized) return true;
    return s.title_ar ? normalizeTitle(s.title_ar) === normalized : false;
  });
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
  if (await findActiveDuplicateSubject(trimmed)) {
    return { ok: false, errorKey: "duplicate" };
  }

  const { data: id, error } = await supabase.rpc("create_subject", {
    p_title: trimmed,
  });
  if (error) return { ok: false, errorKey: mapRpcError(error.message) };

  revalidateResources(lang);
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
   exams as compensation. Storage paths are read with the service-role client
   BEFORE the soft delete (RLS would hide them afterwards). */
export async function deleteSubjectAction(
  lang: string,
  id: string
): Promise<SubjectActionResult> {
  const session = await authorizeContributor(lang);
  if (!session) return { ok: false, errorKey: "notAllowed" };

  /* Read storage paths of child files while they are still visible. */
  const admin = createAdminClient();
  const { data: summaries } = await admin
    .from("summaries")
    .select("storage_path")
    .eq("subject_id", id);
  const { data: exams } = await admin
    .from("exam_files")
    .select("storage_path")
    .eq("subject_id", id);
  const paths = [
    ...(summaries ?? []).map((s) => s.storage_path),
    ...(exams ?? []).map((e) => e.storage_path),
  ].filter((p): p is string => Boolean(p));

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_subject", { p_id: id });
  if (error) return { ok: false, errorKey: mapRpcError(error.message) };

  /* Best-effort compensation: remove each stored object. */
  for (const path of paths) {
    try {
      await removeResource(path);
    } catch {
      /* orphaned object left for manual cleanup — safe to continue */
    }
  }

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
