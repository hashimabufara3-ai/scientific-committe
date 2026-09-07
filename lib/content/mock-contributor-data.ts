/* ---------------------------------------------------------------------------
   Contributor workspace — typed data for the materials catalog.
   ---------------------------------------------------------------------------

   This module is the ONE type + helper home for the site's materials catalog.
   Production data is read from PostgreSQL via lib/content/data-access.ts; this
   module supplies the shared types those rows map to, plus the pure helpers
   (localized naming, visibility, duplicate detection) used across the feature.
   Soft delete is modeled with a `deleted` flag: hidden from the UI but still
   present in the array.

   The catalog is resolved by canonical `id`: the /contribute material selector,
   the contributor submissions, the Summaries cards, the material detail page,
   and the summary detail page all identify a material by it.

   The content model is deliberately flat:

       Subject (المادة)
       ├── Summaries
       ├── Optional YouTube videos
       └── Previous exams

   Titles are bilingual: `title` is the canonical (English) name and `titleAr`
   the Arabic display name; every render shows the name matching the current
   locale via `displayName`, and searches match both names.

   The current user has no auth. `CURRENT_USER_ID` ("me") stands in for "the
   person at the keyboard"; records the user creates are authored by that id.
   There is no demo/fictional catalog content: the prototype's seeded demo
   subjects were removed.
   ------------------------------------------------------------------------- */

export const CURRENT_USER_ID = "me";

/* Known contributor display names by language. `authorName()` resolves an id
   against this map; an unknown id must NEVER surface the internal identifier,
   so it falls back to a localized generic contributor label (the caller's
   `anonymous` wording when available, otherwise the locale-safe default). */
export const AUTHOR_NAMES: Record<string, { en: string; ar: string }> = {};

export function authorName(
  id: string,
  lang: "en" | "ar",
  anonymous?: string
): string {
  return (
    AUTHOR_NAMES[id]?.[lang] ??
    anonymous ??
    (lang === "ar" ? "أحد المساهمين" : "A contributor")
  );
}

export type ContributorUser = { id: string; name: string };

/* A single contribution. `source` decides whether the summary body is
   written text or an uploaded file. `videos` is the optional list of YouTube
   URLs attached when publishing — never required.

   For uploads, `fileName` is only the display name: the actual bytes live in
   `fileData` as a data URL. This is the prototype's honest way to keep an
   uploaded file openable after a reload without a backend — the data model
   stays ready for a real storage service (which would replace the data URL
   with a permanent download URL). Legacy rows without `fileData` render the
   filename only and are never presented as downloadable.

   Committee (editorial) summaries migrated into the catalog additionally
   carry `description` / `descriptionAr`, an optional static `fileUrl`
   reference with display metadata (`fileSizeLabel`, `pages`), and
   `externalResources` (e.g. a committee-picked YouTube lecture). */
export type MockSummary = {
  id: string;
  title: string;
  titleAr?: string;
  description?: string;
  descriptionAr?: string;
  source: "upload" | "content";
  fileName?: string;
  fileData?: string;
  fileType?: string;
  fileSize?: number;
  fileUrl?: string;
  fileSizeLabel?: string;
  pages?: number;
  content?: string;
  videos: string[];
  externalResources?: Array<{
    id: string;
    title: string;
    url: string;
    type: string;
  }>;
  /* Production access descriptor for an uploaded file (no base64 bytes). */
  access?: ResourceAccess;
  authorId: string;
  createdAt: number;
  updatedAt?: number;
  deleted?: boolean;
};

export const EXAM_TYPES = ["midterm", "final"] as const;
export type ExamType = (typeof EXAM_TYPES)[number];

export const SEMESTERS = ["first", "second", "summer"] as const;
export type Semester = (typeof SEMESTERS)[number];

/* A previous exam shared for a material. Only the file itself is required:
   `type` picks midterm or final, while the academic `year` (e.g. "2024/2025")
   and `semester` are optional — an absent value renders as "Unknown". The file
   is either uploaded bytes (`fileData` data URL) or a static reference
   (`fileUrl`), the same two shapes a summary file can take. */
export type MockExam = {
  id: string;
  type: ExamType;
  year?: string;
  semester?: Semester;
  fileName: string;
  fileData?: string;
  fileType?: string;
  fileSize?: number;
  fileUrl?: string;
  /* Production access descriptor for an uploaded file (no base64 bytes). */
  access?: ResourceAccess;
  authorId: string;
  createdAt: number;
  updatedAt?: number;
  deleted?: boolean;
};

/* A material in the catalog. `id` is the canonical identity used everywhere:
   the Contribute selector, contributor submissions, the Summaries card, the
   material detail page, and the summary detail page. `title` / `titleAr` are
   the localized names, `category` the localized-category id (labels come from
   the dictionaries). */
export type MockSubject = {
  id: string;
  title: string;
  titleAr?: string;
  category?: string;
  authorId: string;
  createdAt: number;
  updatedAt?: number;
  deleted?: boolean;
  summaries: MockSummary[];
  exams: MockExam[];
};

export type ActivityKind =
  | "subject"
  | "summary"
  | "exam"
  | "edit"
  | "delete";

/* One entry of the persisted "Recent Activity" feed. Events are written
   server-side (record_contributor_activity) after every successful contributor
   mutation and read back through the public recent_contributor_activity RPC —
   they are never produced by the browser session. */
export type ActivityEvent = {
  id: string;
  kind: ActivityKind;
  /* Resource kind the edit/delete event refers to ('subject'/'summary'/'exam'),
     carried from the RPC's `kind` column so delete wording can name the kind
     correctly (e.g. «حذف مادة» vs «حذف ملخصًا من مادة»). Absent for legacy
     edit/delete rows (NULL kind — never guessed), which fall back to the
     generic edit/delete wording. */
  resourceKind?: "subject" | "summary" | "exam";
  /* Localized resource title (subject/summary events). Undefined for exam
     events, which instead carry `examType` and resolve the label locally. */
  title?: string;
  /* Present only for exam-family events (created/edited/deleted). */
  examType?: ExamType;
  /* Localized name of the parent subject the event belongs to (resolved
     server-side from the authoritative subject row). Undefined when the event
     predates subject tagging or its subject is missing — the feed falls back
     to a localized generic label and never emits the raw id. */
  subjectName?: string;
  /* Localized public display name of the actor. Undefined when the profile
     has no usable name — the feed falls back to a localized generic label. */
  actorName?: string;
  /* True when the signed-in contributor performed the event themselves. */
  isOwn?: boolean;
  createdAt: number;
};

/* ---- Pure helpers --------------------------------------------------------- */

/* Production (Postgres + Supabase Storage) access descriptor. Present only for
   resources backed by a real stored object: the client fetches a short-lived
   signed URL for `kind`+`id` on demand (View/Download) rather than carrying
   bytes. Absent for prototype rows that use `fileData`. */
export type ResourceAccess = { kind: "summary" | "exam"; id: string };

export const isOwnedByMe = (authorId: string) => authorId === CURRENT_USER_ID;

/* Title matching for duplicate-subject prevention: trim, case-fold, and
   collapse inner whitespace so "Physics 2" and "physics  2" are the same. */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export function visibleSummaries(subject: MockSubject): MockSummary[] {
  return subject.summaries.filter((s) => !s.deleted);
}

export function visibleExams(subject: MockSubject): MockExam[] {
  return subject.exams.filter((e) => !e.deleted);
}

export function subjectChildCounts(subject: MockSubject) {
  const summaries = visibleSummaries(subject);
  const videos = summaries.reduce(
    (acc, s) => acc + (s.videos?.length ?? 0),
    0
  );
  return {
    summaries: summaries.length,
    videos,
    exams: visibleExams(subject).length,
  };
}

/* Localized display name for a material or summary title. */
export function displayName(
  title: string,
  titleAr: string | undefined,
  lang: string
): string {
  return lang === "ar" && titleAr ? titleAr : title;
}

/* Everything a search should match for a material: both the English and the
   Arabic name, case-folded. Used by the Contribute selector and the Summaries
   search so the two pages always agree on the same catalog. */
export function subjectSearchText(subject: MockSubject): string {
  return `${subject.title} ${subject.titleAr ?? ""}`.trim().toLowerCase();
}

/* The pure, ACTIVE-only duplicate predicate used by the server's authoritative
   duplicate check. Given the candidate name and the ACTIVE subject rows (each
   with `title` and a nullable `title_ar`), returns true when an active subject
   matches in either language. NULL/empty `title_ar` never produces a false
   match. Kept pure so the exact enforcement logic can be exercised
   deterministically in tests and is identical everywhere it is used. */
export function subjectIsDuplicate(
  activeSubjects: Array<{ title: string; title_ar: string | null }>,
  candidate: string
): boolean {
  const normalized = normalizeTitle(candidate);
  return activeSubjects.some((s) => {
    if (normalizeTitle(s.title) === normalized) return true;
    return s.title_ar ? normalizeTitle(s.title_ar) === normalized : false;
  });
}

/* ---- My Contributions (server-fed) ---------------------------------------- */

/* The parent-subject context used for a non-subject contribution: enough to
   render the "in {subject}" line and open the subject workspace. Deliberately
   slim — never ships the parent's full row (or its other contributors' rows)
   to the browser. */
export type MySubjectRef = {
  id: string;
  title: string;
  titleAr?: string;
};

/* One line of the "My Contributions" list. Every item carries its OWN
   `authorId` (the contribution's author, not the enclosing subject's) so
   attribution renders as "you" for the signed-in contributor. `authorId` is
   the viewer's own id — safe to expose to the viewer themselves. */
export type MyContribution =
  | {
      key: string;
      kind: "subject";
      subject: MockSubject;
      authorId: string;
    }
  | {
      key: string;
      kind: "summary";
      subject: MySubjectRef;
      summary: MockSummary;
      authorId: string;
    }
  | {
      key: string;
      kind: "exam";
      subject: MySubjectRef;
      exam: MockExam;
      authorId: string;
    };

/* Assemble the "My Contributions" list from rows already scoped by the
   server-side query. The function is a pure, testable ENFORCEMENT layer (not a
   browse-side filter): regardless of what the caller passes in, only items
   whose `authorId` equals `viewerId` are ever emitted, and a summary/exam whose
   parent subject is absent (missing or inactive) is never surfaced. Runs on the
   server inside data-access.ts; the browser only ever receives the result. */
export function buildMyContributions(input: {
  ownedSubjects: MockSubject[];
  summaries: Array<MockSummary & { subjectId: string }>;
  exams: Array<MockExam & { subjectId: string }>;
  parentsBySubjectId: ReadonlyMap<string, MySubjectRef>;
  viewerId: string;
}): MyContribution[] {
  const items: MyContribution[] = [];

  for (const subject of input.ownedSubjects) {
    if (subject.authorId !== input.viewerId) continue;
    items.push({
      key: `subject-${subject.id}`,
      kind: "subject",
      subject,
      authorId: subject.authorId,
    });
  }

  for (const summary of input.summaries) {
    if (summary.authorId !== input.viewerId) continue;
    const subject = input.parentsBySubjectId.get(summary.subjectId);
    if (!subject) continue;
    items.push({
      key: `summary-${summary.id}`,
      kind: "summary",
      subject,
      summary,
      authorId: summary.authorId,
    });
  }

  for (const exam of input.exams) {
    if (exam.authorId !== input.viewerId) continue;
    const subject = input.parentsBySubjectId.get(exam.subjectId);
    if (!subject) continue;
    items.push({
      key: `exam-${exam.id}`,
      kind: "exam",
      subject,
      exam,
      authorId: exam.authorId,
    });
  }

  /* Newest first within each kind; the DB already orders inputs this way, the
     sort is defensive so rendering never depends on query order. */
  const createdAt = (item: MyContribution): number =>
    item.kind === "subject"
      ? item.subject.createdAt
      : item.kind === "summary"
        ? item.summary.createdAt
        : item.exam.createdAt;
  return items.sort((a, b) => createdAt(b) - createdAt(a));
}
