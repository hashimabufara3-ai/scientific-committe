/* Server data-access layer for the public Resources/Summaries section.

   These helpers fetch PUBLIC, ACTIVE metadata from PostgreSQL and map each row
   back into the existing UI shape (MockSubject/MockSummary/MockExam from
   mock-contributor-data.ts) so the presentational components keep working
   with only a data-source change.

   IMPORTANT (mobile + security):
   - PDF BYTES are never returned here. For uploaded files we return only
     metadata plus, on demand, a short-lived signed URL in `accessUrl`.
   - Public reads use the anonymous, cookie-free client so the routes are not
     forced dynamic and can be statically rendered / ISR-cached.
   - Individual signed URLs live in their own helper
     (getSummaryAccessUrl / getExamAccessUrl) so a student receives a URL only
     when they explicitly choose View/Download.
*/

import { createAnonClient } from "../auth/supabase-anon";
import { createSignedResourceUrl } from "./storage";
import type { MockExam, MockSubject, MockSummary } from "./mock-contributor-data";

/* A contributor-authored summary exposes an optional accessUrl instead of a
   base64 fileData. Casted shape — see below. */
type AccessSummary = MockSummary & { accessUrl?: string };
type AccessExam = MockExam & { accessUrl?: string };
type AccessSubject = Omit<MockSubject, "summaries" | "exams"> & {
  summaries: AccessSummary[];
  exams: AccessExam[];
};

function rowToExam(row: {
  id: string;
  type: "midterm" | "final";
  year: string | null;
  semester: "first" | "second" | "summer" | null;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  file_url: string | null;
  storage_path: string | null;
  author_id: string;
  created_at: string;
  updated_at: string;
}): AccessExam {
  return {
    id: row.id,
    type: row.type,
    year: row.year ?? undefined,
    semester: row.semester ?? undefined,
    fileName: row.file_name,
    fileType: row.mime_type ?? undefined,
    fileSize: row.file_size ?? undefined,
    fileUrl: row.file_url ?? undefined,
    access: row.storage_path ? { kind: "exam", id: row.id } : undefined,
    authorId: row.author_id,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined,
  };
}

function rowToSummary(row: {
  id: string;
  title: string;
  title_ar: string | null;
  description: string | null;
  description_ar: string | null;
  source: "upload" | "content";
  content: string | null;
  videos: string[];
  file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  file_url: string | null;
  file_size_label: string | null;
  pages: number | null;
  external_resources: Record<string, unknown>[];
  storage_path: string | null;
  author_id: string;
  created_at: string;
  updated_at: string;
}): AccessSummary {
  const externalResources = Array.isArray(row.external_resources)
    ? (row.external_resources as { id: string; title: string; url: string; type: string }[])
    : [];
  return {
    id: row.id,
    title: row.title,
    titleAr: row.title_ar ?? undefined,
    description: row.description ?? undefined,
    descriptionAr: row.description_ar ?? undefined,
    source: row.source,
    content: row.content ?? undefined,
    videos: Array.isArray(row.videos) ? row.videos : [],
    fileName: row.file_name ?? undefined,
    fileType: row.mime_type ?? undefined,
    fileSize: row.file_size ?? undefined,
    fileUrl: row.file_url ?? undefined,
    fileSizeLabel: row.file_size_label ?? undefined,
    pages: row.pages ?? undefined,
    externalResources:
      externalResources.length > 0 ? externalResources : undefined,
    access:
      row.source === "upload" && row.storage_path
        ? { kind: "summary", id: row.id }
        : undefined,
    authorId: row.author_id,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined,
  };
}

/* Fetch all active subjects with their active summaries and exams (metadata
   only — no file bytes). Assembly is a small number of queries, fine for the
   catalog size. */
export async function getSubjects(): Promise<MockSubject[]> {
  const supabase = createAnonClient();

  const [subjectsRes, summariesRes, examsRes] = await Promise.all([
    supabase.from("subjects").select("*").eq("is_active", true).order("created_at", { ascending: false }),
    supabase.from("summaries").select("*").eq("is_active", true).order("created_at", { ascending: false }),
    supabase.from("exam_files").select("*").eq("is_active", true).order("created_at", { ascending: false }),
  ]);

  if (subjectsRes.error) return [];
  const bySubject = new Map<string, AccessSubject>();

  for (const s of subjectsRes.data ?? []) {
    bySubject.set(s.id, {
      id: s.id,
      title: s.title,
      titleAr: s.title_ar ?? undefined,
      category: s.category ?? undefined,
      authorId: s.author_id,
      createdAt: new Date(s.created_at).getTime(),
      updatedAt: s.updated_at ? new Date(s.updated_at).getTime() : undefined,
      summaries: [],
      exams: [],
    });
  }

  for (const s of summariesRes.data ?? []) {
    const target = bySubject.get(s.subject_id);
    if (target) target.summaries.push(rowToSummary(s));
  }
  for (const e of examsRes.data ?? []) {
    const target = bySubject.get(e.subject_id);
    if (target) target.exams.push(rowToExam(e));
  }

  return [...bySubject.values()];
}

/* Fetch one active subject (metadata only) with its active summaries/exams,
   or null if it does not exist / is inactive. */
export async function getSubject(id: string): Promise<AccessSubject | null> {
  const supabase = createAnonClient();

  const { data: subject } = await supabase
    .from("subjects")
    .select("*")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  if (!subject) return null;

  const { data: summaries } = await supabase
    .from("summaries")
    .select("*")
    .eq("subject_id", id)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  const { data: exams } = await supabase
    .from("exam_files")
    .select("*")
    .eq("subject_id", id)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  const base: Omit<AccessSubject, "summaries" | "exams"> = {
    id: subject.id,
    title: subject.title,
    titleAr: subject.title_ar ?? undefined,
    category: subject.category ?? undefined,
    authorId: subject.author_id,
    createdAt: new Date(subject.created_at).getTime(),
    updatedAt: subject.updated_at ? new Date(subject.updated_at).getTime() : undefined,
  };

  return {
    ...base,
    summaries: (summaries ?? []).map(rowToSummary),
    exams: (exams ?? []).map(rowToExam),
  };
}

/* Public metadata for a single summary within a subject (metadata only).
   Returns null when the subject/summary is missing or inactive. */
export async function getSummary(
  subjectId: string,
  summaryId: string
): Promise<AccessSummary | null> {
  const supabase = createAnonClient();
  const { data: summary } = await supabase
    .from("summaries")
    .select("*")
    .eq("id", summaryId)
    .eq("subject_id", subjectId)
    .eq("is_active", true)
    .maybeSingle();
  return summary ? rowToSummary(summary) : null;
}

/* A server-side reference to an ACTIVE resource's stored object, resolved by
   the same RLS-guarded public client used everywhere else. The download route
   reads these fields (never a client-minted URL) to fetch bytes server-side. */
export type ResourceStorageRef = {
  kind: "summary" | "exam";
  storagePath: string;
  fileName: string;
  mimeType: string | null;
};

/* Resolve an active summary/exam row to its stored object reference (path +
   original filename + content type). Returns null when the row is missing,
   inactive, or has no stored object. Used by the same-origin download endpoint
   so callers can fetch bytes server-side and stream them back as an attachment
   (the browser never sees Storage credentials or a signed URL). */
export async function getResourceStorageRef(
  kind: "summary" | "exam",
  id: string
): Promise<ResourceStorageRef | null> {
  if (kind === "summary") {
    const { data, error } = await createAnonClient()
      .from("summaries")
      .select("storage_path, file_name, mime_type")
      .eq("id", id)
      .eq("is_active", true)
      .maybeSingle();
    if (error || !data?.storage_path) return null;
    return {
      kind,
      storagePath: data.storage_path,
      fileName: data.file_name ?? "download",
      mimeType: data.mime_type,
    };
  }

  const { data, error } = await createAnonClient()
    .from("exam_files")
    .select("storage_path, file_name, mime_type")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data?.storage_path) return null;
  return {
    kind,
    storagePath: data.storage_path,
    fileName: data.file_name ?? "download",
    mimeType: data.mime_type,
  };
}

/* Generate a short-lived signed URL for a summary's stored file.
   Only called when the student explicitly chooses View/Download. Returns null
   if the summary is an inline (content) entry or has no stored object. */
export async function getSummaryAccessUrl(
  summaryId: string
): Promise<string | null> {
  const supabase = createAnonClient();
  const { data: summary } = await supabase
    .from("summaries")
    .select("storage_path")
    .eq("id", summaryId)
    .eq("is_active", true)
    .maybeSingle();
  if (!summary?.storage_path) return null;
  return createSignedResourceUrl(summary.storage_path);
}

/* Generate a short-lived signed URL for an exam file. Returns null if the
   exam has no stored object. */
export async function getExamAccessUrl(
  examId: string
): Promise<string | null> {
  const supabase = createAnonClient();
  const { data: exam } = await supabase
    .from("exam_files")
    .select("storage_path")
    .eq("id", examId)
    .eq("is_active", true)
    .maybeSingle();
  if (!exam?.storage_path) return null;
  return createSignedResourceUrl(exam.storage_path);
}
