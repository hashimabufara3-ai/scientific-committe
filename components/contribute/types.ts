import type { Dictionary } from "@/app/[lang]/dictionaries";
import type { ExamType, Semester } from "@/lib/content/mock-contributor-data";

export type ContributeDict = Awaited<ReturnType<Dictionary>>["contributePage"];

/* Phase of a direct-to-Storage file upload (drives the busy indicator text).
   null = not uploading (e.g. inline content publish). */
export type UploadPhase = "preparing" | "uploading" | "finalizing" | null;

/* Which screen the contributor is looking at. Pure client-side navigation —
   no URL routing, no persistence, matching the in-memory prototype. */
export type View =
  | { name: "dashboard" }
  | { name: "subject"; subjectId: string };

/* The add-form currently expanded inline (only one at a time per screen).
   A form opened from inside a subject workspace carries that subject id as a
   fixed subject — the form opens directly for it and never shows a picker;
   from the dashboard the contributor chooses. */
export type OpenForm =
  | { kind: "summary"; subjectId?: string }
  | { kind: "exam"; subjectId: string }
  | null;

/* The row currently being edited inline (replaces the row with its form). */
export type EditingState =
  | { kind: "subject"; id: string }
  | { kind: "summary"; subjectId: string; id: string }
  | { kind: "exam"; subjectId: string; id: string }
  | null;

/* What the delete confirmation dialog is asking about. Counts are filled in
   at request time so the warning text reflects live dependencies. */
export type DeleteTarget =
  | {
      kind: "subject";
      id: string;
      name: string;
      counts: { summaries: number; videos: number; exams: number };
    }
  | { kind: "summary"; subjectId: string; id: string; name: string }
  | { kind: "exam"; subjectId: string; id: string; name: string };

/* ---- Form value shapes (shared by create + inline edit) ------------------ */

/* A subject's localized names: `title` is the English title and `titleAr` the
   Arabic title. Both are required on create/edit; `titleAr` is typed optional
   so legacy rows with a NULL Arabic title still load into the edit form, but
   submission and the server reject a missing Arabic title. Never stored as one
   field. */
export type SubjectFormValues = {
  title: string;
  titleAr?: string;
};

/* How the summary form resolves its subject: either an existing catalog
   subject id picked from the list, or the localized names of a brand-new
   material. Exactly one of subjectId / title is set on submit. */
export type SubjectRef = {
  subjectId?: string;
  title?: string;
  titleAr?: string;
};

export type SummaryFormValues = {
  title: string;
  source: "upload" | "content";
/* The raw browser File chosen for a NEW upload. Absent when editing an
      existing upload without replacing its file (metadata-only update). The
      bytes are never read as a data URL — they go directly to Storage via a
      short-lived signed upload URL issued by /api/resources/upload-auth. */
  file?: File;
  /* Display name — either the newly chosen file's name or the existing
     stored file's name when editing (no replacement). */
  fileName: string;
  fileType?: string;
  fileSize?: number;
  content: string;
  /* Optional YouTube URLs — never required to publish, multiple allowed. */
  videos: string[];
  /* Optional previous exam attached while creating a new subject. Completely
     optional — omit it to create the subject exactly as before. */
  exam?: ExamFormValues;
};

/* A previous exam contribution: the file is required, while the academic year
   and semester are optional ("unknown" when empty). */
export type ExamFormValues = {
  type: ExamType;
  /* Academic year, e.g. "2024/2025" — empty means unknown. */
  year: string;
  /* Empty string means unknown semester. */
  semester: Semester | "";
  /* Newly chosen raw File, or absent when editing without replacement. */
  file?: File;
  fileName: string;
  fileType?: string;
  fileSize?: number;
};
