/* ---------------------------------------------------------------------------
   Contributor workspace — typed data for the materials catalog.
   ---------------------------------------------------------------------------

   This module is the ONE type + helper home for the site's materials catalog.
   There is no database, backend, or API behind it: the shared content store
   (content-store.ts) holds the in-memory catalog and persists it to
   localStorage, and every add / edit / delete mutates that store. Soft delete
   is simulated with a `deleted` flag: hidden from the UI but still present in
   the array.

   Because the catalog lives in the shared store, everything else is derived
   from it: the /contribute material selector, the contributor submissions,
   the Summaries cards, the material detail page, and the summary detail page
   all resolve a material by its canonical `id`.

   The content model is deliberately flat:

       Subject (المادة)
       ├── Summaries
       ├── Optional YouTube videos
       └── Previous exams

   Titles are bilingual: `title` is the canonical (English) name and `titleAr`
   the Arabic display name; every render shows the name matching the current
   locale via `displayName`, and searches match both names.

   The current user has no auth. `CURRENT_USER_ID` stands in for "the person
   at the keyboard"; every record the user creates is authored by that id.
   There is intentionally NO demo/fictional catalog content here any more —
   the prototype previously shipped seeded demo subjects; those have been
   removed and existing stored demo records are filtered out on load (see
   stripDemoRecords).
   ------------------------------------------------------------------------- */

export const CURRENT_USER_ID = "me";

/* Fictional seeded contributors were removed. authorName() is retained as a
   generic helper: for any (future) non-owned author id it just returns the
   raw id, since localization of other users' names is not needed yet. */
export const AUTHOR_NAMES: Record<string, { en: string; ar: string }> = {};

export function authorName(id: string, lang: "en" | "ar"): string {
  return AUTHOR_NAMES[id]?.[lang] ?? id;
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
  | "video"
  | "exam"
  | "edit"
  | "delete";

export type ActivityEvent = {
  id: string;
  kind: ActivityKind;
  title?: string;
  createdAt: number;
};

/* ---- Pure helpers --------------------------------------------------------- */

export const isOwnedByMe = (authorId: string) => authorId === CURRENT_USER_ID;

/* Title matching for duplicate-subject prevention: trim, case-fold, and
   collapse inner whitespace so "Physics 2" and "physics  2" are the same. */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export function visibleSubjects(subjects: MockSubject[]): MockSubject[] {
  return subjects.filter((s) => !s.deleted);
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

export function videoCount(subject: MockSubject): number {
  return subjectChildCounts(subject).videos;
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

/* Whether a candidate material name (typed in either language) refers to an
   existing catalog subject — duplicate-prevention across locales. */
export function subjectMatches(subject: MockSubject, candidate: string): boolean {
  const normalized = normalizeTitle(candidate);
  if (normalizeTitle(subject.title) === normalized) return true;
  return subject.titleAr
    ? normalizeTitle(subject.titleAr) === normalized
    : false;
}

/* Sessions saved to localStorage may be missing optional fields. Normalize
   anything loaded from storage back into the current shape (defaulting missing
   videos and exams to their empty values) so legacy data reads safely, and
   filter out the (removed) demo records while preserving user-created records. */
export function normalizeStoredSubjects(raw: unknown): MockSubject[] {
  if (!Array.isArray(raw)) return [];
  return stripDemoRecords(
    raw.map((item) => {
      const subject = (item ?? {}) as Partial<MockSubject>;
      const summaries = Array.isArray(subject.summaries)
        ? subject.summaries.map((summary) => {
            const videos = (summary as { videos?: unknown })?.videos;
            return {
              ...summary,
              videos: Array.isArray(videos) ? videos : [],
            };
          })
        : [];
      return {
        ...subject,
        summaries,
        exams: Array.isArray(subject.exams) ? subject.exams : [],
      } as MockSubject;
    })
  );
}

/* ---- Small unique-id factory (prototype stand-in for DB ids) ------------- */

let counter = 0;

export function makeId(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/* ---- Demo/fictional record filter ------------------------------------------
   The original prototype shipped a set of fictional catalog records as its
   default content. User-created records use ids produced by makeId() (a
   timestamp+counter suffix), so the demo ids below are structurally distinct
   and are never generated at runtime. During localStorage hydration we strip
   exactly these ids so that any real user-created records are preserved while
   all demo records disappear. Nothing outside these exact ids is removed. */

const DEMO_SUBJECT_IDS = new Set([
  "networks",
  "oop",
  "os",
  "dld",
  "phys2",
]);

const DEMO_SUMMARY_IDS = new Set([
  "networks-comprehensive",
  "networks-osi",
  "networks-chapter1",
  "networks-qa",
  "networks-brief",
  "oop-basics",
  "os-processes",
  "dld-gates",
  "dl-gates-cheat",
  "phys2-ef-formula",
  "phys2-circuits-notes",
]);

const DEMO_EXAM_IDS = new Set([
  "networks-midterm-1",
  "networks-final-1",
]);

/* Remove demo subjects entirely, and remove demo summaries/exams from any
   subject that remains. Subjects/summaries/exams with any other id are kept. */
export function stripDemoRecords(subjects: MockSubject[]): MockSubject[] {
  return subjects
    .filter((s) => !DEMO_SUBJECT_IDS.has(s.id))
    .map((s) => ({
      ...s,
      summaries: s.summaries.filter((m) => !DEMO_SUMMARY_IDS.has(m.id)),
      exams: s.exams.filter((e) => !DEMO_EXAM_IDS.has(e.id)),
    }));
}

/* ---- Seed data --------------------------------------------------------------
   Exposed only so server-side metadata lookups (resources/* pages) keep a
   stable function signature. The catalog itself now starts EMPTY — the
   content store no longer seeds demo content, and any demo records already
   saved to localStorage are filtered out on load via stripDemoRecords(). */
export function seedContributorData() {
  return { subjects: [] as MockSubject[], activities: [] as ActivityEvent[] };
}
