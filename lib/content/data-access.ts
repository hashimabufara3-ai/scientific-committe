/* Server data-access layer for the public Resources/Summaries section.

   These helpers fetch PUBLIC, ACTIVE metadata from PostgreSQL and map each row
   back into the existing UI shape (MockSubject/MockSummary/MockExam from
   mock-contributor-data.ts) so the presentational components keep working
   with only a data-source change.

   IMPORTANT (mobile + security):
   - Uploaded FILE BYTES are never returned here. For uploaded files we return
     only metadata plus, on demand, a short-lived signed URL in `accessUrl`.
   - Public reads use the anonymous, cookie-free client so the routes are not
     forced dynamic and can be statically rendered / ISR-cached.
   - Individual signed URLs live in their own helper
     (getSummaryAccessUrl / getExamAccessUrl) so a student receives a URL only
     when they explicitly choose View/Download.
*/

import { createAnonClient } from "../auth/supabase-anon";
import { createAdminClient } from "../auth/supabase-server";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../auth/database-types";
import { toActivityEvents } from "./contributor-activity";
import { createSignedResourceUrl } from "./storage";
import { buildMyContributions } from "./mock-contributor-data";
import type {
  ActivityEvent,
  MockExam,
  MockSubject,
  MockSummary,
  MyContribution,
  MySubjectRef,
} from "./mock-contributor-data";

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

const MAX_PAGE_SIZE = 50;

/* Escape LIKE metacharacters (% _ \) so user input matches literally (Postgres'
   default LIKE escape character is backslash). */
const escapeLike = (term: string): string =>
  term.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/* ASCII characters PostgREST's .or() filter grammar treats as delimiters (`,`),
   grouping (`(` `)`) or quoting (`'` `"`). They cannot be escaped inside an
   .or() string; a term containing any of them is matched via two single-condition
   ilike queries instead (each value is its own URL-encoded query parameter, so
   it is grammar-safe). Non-ASCII punctuation (e.g. Arabic comma U+060C) is NOT
   part of PostgREST's grammar and stays on the .or() path. */
const OR_GRAMMAR_HAZARD = /['"(),]/;

/* Slim subject projection used for search matching, counting and page slicing. */
const SUBJECT_SEARCH_COLUMNS =
  "id, title, title_ar, category, author_id, created_at, updated_at";

/* Row shape returned by the slim subject projection above. */
type SubjectSearchRow = {
  id: string;
  title: string;
  title_ar: string | null;
  category: string | null;
  author_id: string;
  created_at: string;
  updated_at: string;
};

export type SubjectPageResult = {
  subjects: MockSubject[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

/* Fetch one page of ACTIVE subjects with optional bilingual search, returning
   pagination metadata alongside the page.

   Counting and pagination are based on the subjects that ACTUALLY appear in
   the catalog UI — an active subject is visible when it has at least one
   active summary OR one active exam file (matching the original, unfiltered
   behavior). `total` is therefore the count of visible MATCHING subjects, not
   of every active subject.

   Query strategy (avoids fetching all summaries/exams globally):
   1. Resolve the matching active subjects in deterministic order
      (created_at DESC, then id DESC as stable secondary key). Bilingual
      search (title/title_ar ilike) runs at the DB level.
   2. Resolve which of those subjects have active resources using slim
      subject_id-only queries against summaries and exam_files (bounded to the
      matching subject ids). That set is what `total` is computed from.
   3. Slice the visible, still-deterministically-ordered rows for the
      requested page. Out-of-range pages clamp to the last valid page, so the
      UI never renders a misleading empty page.
   4. Fetch summaries/exam_files ONLY for the current page's subject ids. */
export async function getSubjectsPage(params: {
  page?: number;
  pageSize?: number;
  search?: string;
}): Promise<SubjectPageResult> {
  const supabase = createAnonClient();

  const pageSize = Math.min(
    Math.max(1, Math.floor(params.pageSize ?? 12)),
    MAX_PAGE_SIZE
  );
  const requestedPage = Number.isFinite(params.page)
    ? Math.max(1, Math.floor(params.page as number))
    : 1;
  const search = (params.search ?? "").trim();

  /* 1. Matching active subjects, deterministically ordered.

     Bilingual search runs at the DB level (title ilike q OR title_ar ilike q).
     The normal path uses a single .or() filter. When the term contains ASCII
     punctuation reserved by PostgREST's .or() grammar (see OR_GRAMMAR_HAZARD),
     the same matching is done with two single-condition .ilike queries and the
     rows unioned/deduped; both paths yield an identical, deterministically
     ordered row set, so counting and pagination below are unaffected. */
  let subjectQuery = supabase
    .from("subjects")
    .select(SUBJECT_SEARCH_COLUMNS)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  let subjectsRes: SubjectSearchRow[] | null = null;
  let subjectsError: PostgrestError | null = null;

  const escapedSearch = search ? escapeLike(search) : "";
  if (search && OR_GRAMMAR_HAZARD.test(search)) {
    const pattern = `%${escapedSearch}%`;
    const [titleRes, titleArRes] = await Promise.all([
      supabase
        .from("subjects")
        .select(SUBJECT_SEARCH_COLUMNS)
        .eq("is_active", true)
        .ilike("title", pattern)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
      supabase
        .from("subjects")
        .select(SUBJECT_SEARCH_COLUMNS)
        .eq("is_active", true)
        .ilike("title_ar", pattern)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
    ]);
    subjectsError = titleRes.error ?? titleArRes.error ?? null;
    if (!subjectsError) {
      const byId = new Map<string, SubjectSearchRow>();
      for (const row of [...(titleRes.data ?? []), ...(titleArRes.data ?? [])]) {
        byId.set(row.id, row);
      }
      subjectsRes = [...byId.values()].sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)
      );
    }
  } else {
    if (search) {
      subjectQuery = subjectQuery.or(
        `title.ilike.%${escapedSearch}%,title_ar.ilike.%${escapedSearch}%`
      );
    }
    const result = await subjectQuery;
    subjectsRes = result.data;
    subjectsError = result.error;
  }

  if (subjectsError) {
    return { subjects: [], page: 1, pageSize, total: 0, totalPages: 1 };
  }

  const matchingIds = (subjectsRes ?? []).map((s) => s.id);

  /* 2. Which matching subjects actually have active summaries/exams. */
  const visibleIds = new Set<string>();
  if (matchingIds.length > 0) {
    const [{ data: summaryRefs }, { data: examRefs }] = await Promise.all([
      supabase
        .from("summaries")
        .select("subject_id")
        .eq("is_active", true)
        .in("subject_id", matchingIds),
      supabase
        .from("exam_files")
        .select("subject_id")
        .eq("is_active", true)
        .in("subject_id", matchingIds),
    ]);
    for (const r of summaryRefs ?? []) visibleIds.add(r.subject_id);
    for (const r of examRefs ?? []) visibleIds.add(r.subject_id);
  }

  /* 3. Visible matching subjects, preserving the deterministic DB order. */
  const visibleRows = (subjectsRes ?? []).filter((s) => visibleIds.has(s.id));
  const total = visibleRows.length;
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;
  const page = Math.min(Math.max(1, requestedPage), totalPages);

  /* 4. The requested page slice of visible subjects. */
  const from = (page - 1) * pageSize;
  const pageRows = visibleRows.slice(from, from + pageSize);

  const bySubject = new Map<string, AccessSubject>();
  for (const s of pageRows) {
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

  /* 5. Fetch summaries/exam_files ONLY for the current page's subjects. */
  const pageIds = Array.from(bySubject.keys());
  if (pageIds.length > 0) {
    const [{ data: summariesRes }, { data: examsRes }] = await Promise.all([
      supabase
        .from("summaries")
        .select("*")
        .eq("is_active", true)
        .in("subject_id", pageIds)
        .order("created_at", { ascending: false }),
      supabase
        .from("exam_files")
        .select("*")
        .eq("is_active", true)
        .in("subject_id", pageIds)
        .order("created_at", { ascending: false }),
    ]);
    for (const s of summariesRes ?? []) {
      const target = bySubject.get(s.subject_id);
      if (target) target.summaries.push(rowToSummary(s));
    }
    for (const r of examsRes ?? []) {
      const target = bySubject.get(r.subject_id);
      if (target) target.exams.push(rowToExam(r));
    }
  }

  return {
    subjects: [...bySubject.values()],
    page,
    pageSize,
    total,
    totalPages,
  };
}

/* Fetch active subjects with their active summaries/exams.

   Backward compatible: with NO arguments this keeps the original fetch-all
   behavior (used by the Contribute page selector). With page/pageSize/search
   it simply returns the subjects of the requested page — use
   getSubjectsPage() when pagination metadata is needed. */
export async function getSubjects(
  params?: { page?: number; pageSize?: number; search?: string }
): Promise<MockSubject[]> {
  if (!params) {
    const supabase = createAnonClient();
    const [subjectsRes, summariesRes, examsRes] = await Promise.all([
      supabase
        .from("subjects")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false }),
      supabase
        .from("summaries")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false }),
      supabase
        .from("exam_files")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false }),
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

    return [...bySubject.values()].filter(
      (s) => s.summaries.length > 0 || s.exams.length > 0
    );
  }

  const { subjects } = await getSubjectsPage(params);
  return subjects;
}

/* Server-scoped "My Contributions" for the signed-in contributor.

   The three content queries are scoped to the user's OWN identity at the SQL
   level (author_id = userId on subjects/summaries/exam_files), so rows
   authored by other contributors never reach the browser. The parent subjects
   needed to render the "in {subject}" context come from a targeted id IN (...)
   query — never the full catalog — and carry only slim MySubjectRef data into
   the returned items. The pure buildMyContributions() gate then re-asserts
   ownership and drops any summary/exam whose parent subject is missing or
   inactive. Runs through the session's SSR client (the user's cookie session),
   matching getRecentContributorActivity.

   A subject's child counts (for owned subjects) reflect ALL its active
   children, matching the catalog card the same subject shows. */
export async function getMyContributions(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<MyContribution[]> {
  const [subjectsRes, summariesRes, examsRes] = await Promise.all([
    supabase
      .from("subjects")
      .select("*")
      .eq("author_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    supabase
      .from("summaries")
      .select("*")
      .eq("author_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    supabase
      .from("exam_files")
      .select("*")
      .eq("author_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
  ]);

  if (subjectsRes.error || summariesRes.error || examsRes.error) return [];

  const ownedSubjects = subjectsRes.data ?? [];
  const mySummaries = summariesRes.data ?? [];
  const myExams = examsRes.data ?? [];

  /* Parent subjects needed for "in {subject}" context: every owned subject
     plus the parents of the user's own summaries/exams. */
  const parentIds = new Set<string>();
  for (const s of ownedSubjects) parentIds.add(s.id);
  for (const s of mySummaries) parentIds.add(s.subject_id);
  for (const e of myExams) parentIds.add(e.subject_id);
  if (parentIds.size === 0) return [];

  const parentIdList = [...parentIds];
  const [parentsRes, parentSummariesRes, parentExamsRes] = await Promise.all([
    supabase
      .from("subjects")
      .select("*")
      .in("id", parentIdList)
      .eq("is_active", true),
    supabase
      .from("summaries")
      .select("*")
      .in("subject_id", parentIdList)
      .eq("is_active", true),
    supabase
      .from("exam_files")
      .select("*")
      .in("subject_id", parentIdList)
      .eq("is_active", true),
  ]);

  if (parentsRes.error || parentSummariesRes.error || parentExamsRes.error) {
    return [];
  }

  /* Assemble each ACTIVE parent with its active children so owned subjects
     render the same child counts as the catalog card, and build the slim
     parent-ref map for the "in {subject}" lines. */
  const parentsById = new Map<string, AccessSubject>();
  const refs = new Map<string, MySubjectRef>();
  for (const s of parentsRes.data ?? []) {
    refs.set(s.id, {
      id: s.id,
      title: s.title,
      titleAr: s.title_ar ?? undefined,
    });
    parentsById.set(s.id, {
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
  for (const s of parentSummariesRes.data ?? []) {
    parentsById.get(s.subject_id)?.summaries.push(rowToSummary(s));
  }
  for (const e of parentExamsRes.data ?? []) {
    parentsById.get(e.subject_id)?.exams.push(rowToExam(e));
  }

  return buildMyContributions({
    ownedSubjects: ownedSubjects
      .map((s) => parentsById.get(s.id))
      .filter((s): s is AccessSubject => Boolean(s)),
    summaries: mySummaries.map((s) => ({
      ...rowToSummary(s),
      subjectId: s.subject_id,
    })),
    exams: myExams.map((e) => ({ ...rowToExam(e), subjectId: e.subject_id })),
    parentsBySubjectId: refs,
    viewerId: userId,
  });
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

/* ---------------------------------------------------------------------------
   Deleted-material detection.

   Deletion is a SOFT delete: the SECURITY DEFINER functions (delete_subject,
   delete_summary, delete_exam) only set is_active = false, keeping the row so
   the app can tell "existed but was removed" from "never existed".

   The anonymous public client respects RLS (public can only SELECT active
   rows), so it cannot observe an inactive row. To distinguish the two cases
   for logged-OUT visitors we probe existence with the service-role (admin)
   client — trusted, server-side only. We read ONLY the is_active flag and
   return a status enum, NEVER row content, so nothing is leaked to the
   caller/browser beyond "active | deleted | missing".

   These helpers are the ONLY places the public detail pages use the admin
   client; the actual content rendered still comes from the anon client via
   getSubject()/getSummary(), so the RLS read path is unchanged.
--------------------------------------------------------------------------- */

export type ResourceState = "active" | "deleted" | "missing";

/* State of a subject/material: active, soft-deleted (row exists, inactive),
   or missing (row never existed). */
export async function getSubjectState(id: string): Promise<ResourceState> {
  const { data, error } = await createAdminClient()
    .from("subjects")
    .select("is_active")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return "missing";
  return data.is_active ? "active" : "deleted";
}

/* ---------------------------------------------------------------------------
   Contributor activity feed (server-persisted "Recent Activity").
--------------------------------------------------------------------------- */

/* Fetch the latest contributor activity events for the signed-in contributor
   session. Runs the SECURITY DEFINER RPC through the caller's SSR client so
   the user's cookie session is used (the RPC itself requires contributor-or-
   above). Returns only public-safe fields — never the actor id — mapped to the
   frontend ActivityEvent[] shape the dashboard feed renders.

   The feed is intentionally OTHER contributors only: when `viewerId` is the
   signed-in user's id, their own events are dropped server-side here (via the
   pure toActivityEvents helper) so the browser never receives them. This
   complements the server-scoped "My Contributions" panel; no RLS/migration
   change is involved — the check is applied to the RPC's own `is_own` flag. */
export async function getRecentContributorActivity(
  supabase: SupabaseClient<Database>,
  lang: string = "en",
  limit: number = 8,
  viewerId?: string
): Promise<ActivityEvent[]> {
  const { data } = await supabase.rpc("recent_contributor_activity", {
    p_limit: limit,
  });
  return toActivityEvents(data, { lang, viewerId });
}

/* State of a summary/article within a subject, and whether its enclosing
   subject is still available. Returns:
     active  - the summary exists, is active, and its subject is active.
     deleted - the summary was soft-deleted, OR its parent subject was removed.
     missing - neither the summary nor its subject exists as a live material
               (a genuine 404). */
export async function getSummaryState(
  subjectId: string,
  summaryId: string
): Promise<ResourceState> {
  const admin = createAdminClient();

  const [summaryRes, subjectRes] = await Promise.all([
    admin.from("summaries").select("is_active").eq("id", summaryId).eq("subject_id", subjectId).maybeSingle(),
    admin.from("subjects").select("is_active").eq("id", subjectId).maybeSingle(),
  ]);

  const summary = summaryRes.data;
  const subject = subjectRes.data;

  if (summary) {
    /* The article exists; it renders only when it AND its parent are active.
       Otherwise it was removed (or its material was) -> unavailable. */
    if (summary.is_active && subject?.is_active) return "active";
    return "deleted";
  }

  /* Article id is unknown. If the subject material itself exists it is a
     never-existing article id -> 404; if the parent was removed -> deleted. */
  if (subject) return subject.is_active ? "missing" : "deleted";
  return "missing";
}
