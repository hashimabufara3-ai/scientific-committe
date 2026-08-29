/* ---------------------------------------------------------------------------
   Shared content store — the ONE content model used by both the contributor
   workspace and the public Resources pages.

   Prototype architecture: an in-memory singleton (seeded from the mock data
   module) that is persisted to localStorage on every mutation, so a subject
   created in /contribute shows up in /summaries and opens correctly. No
   database, backend, or API. On hard reloads the server renders the seed and
   the client hydrates from localStorage right after mount (the same
   hydration-safe pattern the dashboard uses for relative times).

   Structure stays deliberately flat:

       Subject → Summaries / Optional YouTube videos / Previous exams

   No topics, axes, units, chapters, categories, or extra metadata. A subject
   is identified by id; summaries and exams from any number of contributors
   are stored directly on that one subject, so publishing another contribution
   never creates a duplicate subject card.
   ------------------------------------------------------------------------- */

"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  CURRENT_USER_ID,
  makeId,
  normalizeStoredSubjects,
} from "./mock-contributor-data";
import type {
  ExamType,
  MockExam,
  MockSubject,
  MockSummary,
  Semester,
} from "./mock-contributor-data";

const STORAGE_KEY = "sc.content.store.v1";

/* One-time legacy-purge flag. The very first prototype releases auto-seeded
   fictional demo content and older test sessions added more records whose ids
   (makeId-style) are indistinguishable from real user content, so a denylist
   alone can never fully purge them. On the first load after this fix we empty
   the persisted catalog once (confirmed entirely fictional), record that the
   purge ran, and thereafter preserve genuine user-created content on every
   load. The content-store key is NOT renamed to a new version. */
const CLEANUP_KEY = "sc.content.cleanup.v1";

/* The catalog starts empty. User-created records appear as they are added.
   On first load after this fix, any legacy fictional/test dataset persisted in
   localStorage is purged once; afterwards real user content persists. */
let subjects: MockSubject[] = [];
let hydrated = false;
const listeners = new Set<() => void>();

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(subjects));
  } catch {
    /* prototype: storage may be unavailable — the in-memory store still works */
  }
}

function commit(next: MockSubject[]) {
  subjects = next;
  persist();
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): MockSubject[] {
  return subjects;
}

/* Hydration-safe load: called after mount so the initial client render always
   matches the server's empty HTML. On the FIRST load after this fix, any
   legacy fictional/test dataset persisted under STORAGE_KEY is purged once and
   the cleanup flag is recorded. Afterwards, genuine user-created content saved
   under STORAGE_KEY is restored normally (so real additions survive reloads). */
export function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
    if (!window.localStorage.getItem(CLEANUP_KEY)) {
      /* First load after the cleanup rollout: the persisted dataset is the
         confirmed-fictional legacy content. Empty it once so it can never
         reappear, then mark the purge so future real content is preserved. */
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.setItem(CLEANUP_KEY, "1");
      return;
    }
  } catch {
    /* storage unavailable — the empty in-memory store still works */
    return;
  }

  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      subjects = normalizeStoredSubjects(parsed);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(subjects));
      listeners.forEach((l) => l());
    }
  } catch {
    /* ignore malformed storage */
  }
}

export function useContentStore(): MockSubject[] {
  useEffect(() => {
    hydrate();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/* Hydration status as an external store: false on the server and on the very
   first client render (matching the SSR seed HTML), then true the moment the
   localStorage session has been loaded — so a store-only subject id renders
   its content only after hydration and never causes a mismatch. */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => hydrated, () => false);
}

export function getSubject(id: string): MockSubject | undefined {
  return subjects.find((s) => s.id === id && !s.deleted);
}

/* ---- Mutations (each returns the new id so callers can navigate) -------- */

export function createSubject(title: string): string {
  const id = makeId("subj");
  /* The typed name is mirrored into both language fields so a material
     created in either locale always carries a title for the other locale
     too (the localized display falls back gracefully until a real
     translation is added). One stable id — no duplicate across languages. */
  const subject: MockSubject = {
    id,
    title,
    titleAr: title,
    authorId: CURRENT_USER_ID,
    createdAt: Date.now(),
    summaries: [],
    exams: [],
  };
  commit([subject, ...subjects]);
  return id;
}

export function createSummary(
  subjectId: string,
  values: {
    title: string;
    source: "upload" | "content";
    fileName: string;
    fileData?: string;
    fileType?: string;
    fileSize?: number;
    content: string;
    videos: string[];
  }
): string {
  const id = makeId("summ");
  const summary: MockSummary = {
    id,
    title: values.title,
    source: values.source,
    fileName: values.source === "upload" ? values.fileName : undefined,
    fileData: values.source === "upload" ? values.fileData : undefined,
    fileType: values.source === "upload" ? values.fileType : undefined,
    fileSize: values.source === "upload" ? values.fileSize : undefined,
    content: values.source === "content" ? values.content : undefined,
    videos: values.videos.filter((v) => v.trim().length > 0),
    authorId: CURRENT_USER_ID,
    createdAt: Date.now(),
  };
  commit(
    subjects.map((s) =>
      s.id === subjectId
        ? {
            ...s,
            updatedAt: Date.now(),
            summaries: [summary, ...s.summaries],
          }
        : s
    )
  );
  return id;
}

/* Rename only the localized field matching the current language, so editing
   a subject in Arabic updates `titleAr` and in English updates `title` —
   seed subjects keep their real translation untouched and a mirrored new
   material can be completed with its translation in the other locale. */
export function updateSubject(id: string, title: string, lang?: string) {
  commit(
    subjects.map((s) =>
      s.id === id
        ? { ...s, [lang === "ar" ? "titleAr" : "title"]: title, updatedAt: Date.now() }
        : s
    )
  );
}

export function updateSummary(
  subjectId: string,
  id: string,
  values: {
    title: string;
    source: "upload" | "content";
    fileName: string;
    fileData?: string;
    fileType?: string;
    fileSize?: number;
    content: string;
    videos: string[];
  }
) {
  commit(
    subjects.map((s) =>
      s.id === subjectId
        ? {
            ...s,
            updatedAt: Date.now(),
            summaries: s.summaries.map((m) =>
              m.id === id
                ? {
                    ...m,
                    title: values.title,
                    source: values.source,
                    fileName:
                      values.source === "upload" ? values.fileName : undefined,
                    fileData:
                      values.source === "upload" ? values.fileData : undefined,
                    fileType:
                      values.source === "upload" ? values.fileType : undefined,
                    fileSize:
                      values.source === "upload" ? values.fileSize : undefined,
                    content:
                      values.source === "content" ? values.content : undefined,
                    videos: values.videos.filter((v) => v.trim().length > 0),
                    updatedAt: Date.now(),
                  }
                : m
            ),
          }
        : s
    )
  );
}

/* ---- Previous exams ------------------------------------------------------ */

export function createExam(
  subjectId: string,
  values: {
    type: ExamType;
    year: string;
    semester: Semester | "";
    fileName: string;
    fileData?: string;
    fileType?: string;
    fileSize?: number;
  }
): string {
  const id = makeId("exam");
  const exam: MockExam = {
    id,
    type: values.type,
    year: values.year.trim().length > 0 ? values.year.trim() : undefined,
    semester: values.semester || undefined,
    fileName: values.fileName,
    fileData: values.fileData || undefined,
    fileType: values.fileType || undefined,
    fileSize: values.fileSize,
    authorId: CURRENT_USER_ID,
    createdAt: Date.now(),
  };
  commit(
    subjects.map((s) =>
      s.id === subjectId
        ? {
            ...s,
            updatedAt: Date.now(),
            exams: [exam, ...s.exams],
          }
        : s
    )
  );
  return id;
}

export function updateExam(
  subjectId: string,
  id: string,
  values: {
    type: ExamType;
    year: string;
    semester: Semester | "";
    fileName: string;
    fileData?: string;
    fileType?: string;
    fileSize?: number;
  }
) {
  commit(
    subjects.map((s) =>
      s.id === subjectId
        ? {
            ...s,
            updatedAt: Date.now(),
            exams: s.exams.map((e) =>
              e.id === id
                ? {
                    ...e,
                    type: values.type,
                    year:
                      values.year.trim().length > 0
                        ? values.year.trim()
                        : undefined,
                    semester: values.semester || undefined,
                    fileName: values.fileName,
                    fileData: values.fileData || undefined,
                    fileType: values.fileType || undefined,
                    fileSize: values.fileSize,
                    updatedAt: Date.now(),
                  }
                : e
            ),
          }
        : s
    )
  );
}

/* ---- Soft delete --------------------------------------------------------- */

export function removeSubject(id: string) {
  commit(
    subjects.map((s) =>
      s.id === id ? { ...s, deleted: true, updatedAt: Date.now() } : s
    )
  );
}

export function removeSummary(subjectId: string, id: string) {
  commit(
    subjects.map((s) =>
      s.id === subjectId
        ? {
            ...s,
            updatedAt: Date.now(),
            summaries: s.summaries.map((m) =>
              m.id === id ? { ...m, deleted: true, updatedAt: Date.now() } : m
            ),
          }
        : s
    )
  );
}

export function removeExam(subjectId: string, id: string) {
  commit(
    subjects.map((s) =>
      s.id === subjectId
        ? {
            ...s,
            updatedAt: Date.now(),
            exams: s.exams.map((e) =>
              e.id === id ? { ...e, deleted: true, updatedAt: Date.now() } : e
            ),
          }
        : s
    )
  );
}
