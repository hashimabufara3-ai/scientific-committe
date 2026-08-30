"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { subjectMatches } from "@/lib/content/mock-contributor-data";
import type {
  ActivityEvent,
  ActivityKind,
  MockSubject,
} from "@/lib/content/mock-contributor-data";
import {
  createSubjectAction,
  updateSubjectAction,
  deleteSubjectAction,
  createSummaryAction,
  updateSummaryAction,
  deleteSummaryAction,
  createExamAction,
  updateExamAction,
  deleteExamAction,
} from "@/app/[lang]/contribute/actions";
import type {
  ResourceErrorKey,
  SummaryActionResult,
  ExamActionResult,
} from "@/app/[lang]/contribute/actions";
import { ContributeView } from "./views";
import type { Api } from "./views";
import type {
  ContributeDict,
  DeleteTarget,
  EditingState,
  ExamFormValues,
  OpenForm,
  SubjectFormValues,
  SubjectRef,
  SummaryFormValues,
  View,
} from "./types";
import { SparkIcon } from "../icons";

/* The contributor workspace.

   Reads are server-fed: `subjects` is the active catalog fetched in
   /[lang]/contribute/page.tsx via getSubjects() (metadata only) and refreshed
   through router.refresh() after every mutation. Mutations go through the
   Server Actions in app/[lang]/contribute/actions.ts — the single place rows
   are written to the database — and PDF/exam bytes go to Storage via the
   /api/resources/upload route handler (multipart). The browser never reads a
   file as a data URL, never stores bytes in localStorage, and never sends
   bytes through a Server Action argument.

   Ownership gating (edit/delete) uses `currentUserId` (the authenticated
   contributor resolved server-side), not a prototype constant.
*/

type UploadResult = {
  path: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
};

/* Upload a raw browser File to Storage via the Route Handler. Only the Storage
   path + display metadata come back; bytes never leave the request body except
   as the multipart stream being written to the bucket. */
async function uploadFile(
  file: File,
  kind: "summary" | "exam"
): Promise<UploadResult | null> {
  try {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("kind", kind);
    const res = await fetch("/api/resources/upload", { method: "POST", body: fd });
    if (!res.ok) return null;
    return (await res.json()) as UploadResult;
  } catch {
    return null;
  }
}

export default function ContributorDashboard({
  lang,
  t,
  currentUserId,
  subjects,
}: {
  lang: string;
  t: ContributeDict;
  currentUserId: string;
  subjects: MockSubject[];
}) {
  const router = useRouter();
  /* Activity feed starts empty — only real user actions are recorded via
     pushActivity(). */
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [view, setView] = useState<View>({ name: "dashboard" });
  const [openForm, setOpenForm] = useState<OpenForm>(null);
  const [editing, setEditing] = useState<EditingState>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  /* True while an upload / Server Action is running — disables submits. */
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Relative times render only after mount so the SSR HTML (no "now") can
     never disagree with the client's clock. The synchronous set on mount is
     the deliberate hydration-safe way to show "now" immediately after load;
     the rule below would otherwise want this pushed to an interval tick. */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const visible = useMemo(() => subjects, [subjects]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const pushActivity = useCallback((kind: ActivityKind, title?: string) => {
    const event: ActivityEvent = {
      id: `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind,
      title,
      createdAt: Date.now(),
    };
    setActivities((prev) => [event, ...prev]);
  }, []);

  /* Localized message for a Server Action failure. */
  const errorText = useCallback(
    (key?: ResourceErrorKey) => {
      switch (key) {
        case "notAllowed":
          return t.errors.notAllowed;
        case "notFound":
          return t.errors.notFound;
        case "validation":
          return t.errors.validation;
        case "uploadMissing":
          return t.errors.uploadMissing;
        case "notAuthenticated":
          return t.errors.notAllowed;
        default:
          return t.errors.generic;
      }
    },
    [t.errors],
  );

  /* Single re-entrancy guard for every mutation: keeps double submission from
     firing while an upload or Server Action is in flight. */
  const begin = useCallback(() => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  }, []);
  const end = useCallback(() => {
    busyRef.current = false;
    setBusy(false);
  }, []);

  const ownerOf = useCallback(
    (target: DeleteTarget): string | undefined => {
      const subject = subjects.find((s) =>
        target.kind === "subject" ? s.id === target.id : s.id === target.subjectId
      );
      if (!subject) return undefined;
      if (target.kind === "subject") return subject.authorId;
      if (target.kind === "exam") {
        return subject.exams.find((e) => e.id === target.id)?.authorId;
      }
      return subject.summaries.find((m) => m.id === target.id)?.authorId;
    },
    [subjects],
  );

  /* ---- Create ------------------------------------------------------------ */

  const onCreateSummary = useCallback(
    async (subjectRef: SubjectRef, values: SummaryFormValues) => {
      if (!begin()) return;
      try {
        /* Resolve the material this summary attaches to:
           - a picked catalog subject id → that subject;
           - a brand-new material name → a new subject, reusing an existing
             one (matched in either language) instead of creating a duplicate. */
        let subjectId = subjectRef.subjectId;
        if (!subjectId && subjectRef.title) {
          const existing = subjects.find((s) => subjectMatches(s, subjectRef.title!));
          if (existing) {
            subjectId = existing.id;
          } else {
            const created = await createSubjectAction(lang, subjectRef.title!);
            if (!created.ok) {
              showToast(errorText(created.errorKey));
              return;
            }
            subjectId = created.id;
          }
        }
        if (!subjectId) return;

        let resultOk = false;
        if (values.source === "upload") {
          if (!values.file) {
            showToast(t.errors.uploadMissing);
            return;
          }
          const upload = await uploadFile(values.file, "summary");
          if (!upload) {
            showToast(t.errors.upload);
            return;
          }
          const created = await createSummaryAction(lang, {
            subjectId,
            title: values.title,
            source: "upload",
            storagePath: upload.path,
            fileName: upload.fileName,
            mimeType: upload.mimeType,
            fileSize: upload.fileSize,
            videos: values.videos,
          });
          if (!created.ok) {
            showToast(errorText(created.errorKey));
            return;
          }
          resultOk = created.ok;
        } else {
          const created = await createSummaryAction(lang, {
            subjectId,
            title: values.title,
            source: "content",
            content: values.content,
            videos: values.videos,
          });
          if (!created.ok) {
            showToast(errorText(created.errorKey));
            return;
          }
          resultOk = created.ok;
        }
        if (!resultOk) return;

        /* Optional previous exam attached during subject creation — persisted
           after the (possibly just-created) subject, best-effort. */
        if (values.exam?.file) {
          const examUpload = await uploadFile(values.exam.file, "exam");
          if (examUpload) {
            const created = await createExamAction(lang, {
              subjectId,
              type: values.exam.type,
              year: values.exam.year,
              semester: values.exam.semester,
              storagePath: examUpload.path,
              fileName: examUpload.fileName,
              mimeType: examUpload.mimeType,
              fileSize: examUpload.fileSize,
            });
            if (!created.ok) showToast(errorText(created.errorKey));
          } else {
            showToast(t.errors.upload);
          }
        }

        router.refresh();
        pushActivity("summary", values.title);
        if (values.videos.length > 0) pushActivity("video");
        showToast(t.toast.createdSummary);
        setOpenForm(null);
        setEditing(null);
        setView({ name: "subject", subjectId });
      } finally {
        end();
      }
    },
    [begin, end, errorText, lang, pushActivity, router, showToast, subjects, t],
  );

  const onCreateExam = useCallback(
    async (subjectId: string, values: ExamFormValues) => {
      if (!begin()) return;
      try {
        if (!subjectId) return;
        if (!values.file) {
          showToast(t.errors.uploadMissing);
          return;
        }
        const upload = await uploadFile(values.file, "exam");
        if (!upload) {
          showToast(t.errors.upload);
          return;
        }
        const created: ExamActionResult = await createExamAction(lang, {
          subjectId,
          type: values.type,
          year: values.year,
          semester: values.semester,
          storagePath: upload.path,
          fileName: upload.fileName,
          mimeType: upload.mimeType,
          fileSize: upload.fileSize,
        });
        if (!created.ok) {
          showToast(errorText(created.errorKey));
          return;
        }
        router.refresh();
        pushActivity(
          "exam",
          values.type === "midterm"
            ? t.previousExams.midterm
            : t.previousExams.final,
        );
        showToast(t.toast.createdExam);
        setOpenForm(null);
        setEditing(null);
      } finally {
        end();
      }
    },
    [begin, end, errorText, lang, pushActivity, router, showToast, t],
  );

  /* ---- Edit -------------------------------------------------------------- */

  const onSaveSubject = useCallback(
    async (id: string, values: SubjectFormValues) => {
      if (!begin()) return;
      try {
        const r = await updateSubjectAction(lang, id, values.title);
        if (!r.ok) {
          showToast(errorText(r.errorKey));
          return;
        }
        router.refresh();
        pushActivity("edit", values.title);
        showToast(t.toast.updated);
        setEditing(null);
      } finally {
        end();
      }
    },
    [begin, end, errorText, lang, pushActivity, router, showToast, t],
  );

  const onSaveSummary = useCallback(
    async (subjectId: string, id: string, values: SummaryFormValues) => {
      if (!begin()) return;
      try {
        const base = {
          subjectId,
          id,
          title: values.title,
          videos: values.videos,
        };
        let r: SummaryActionResult;
        if (values.source === "upload" && values.file) {
          /* Replacing the uploaded file: upload the new bytes first, then
             update metadata (the action removes the OLD object only after a
             successful DB update). */
          const upload = await uploadFile(values.file, "summary");
          if (!upload) {
            showToast(t.errors.upload);
            return;
          }
          r = await updateSummaryAction(lang, {
            ...base,
            source: "upload",
            storagePath: upload.path,
            fileName: upload.fileName,
            mimeType: upload.mimeType,
            fileSize: upload.fileSize,
          });
        } else if (values.source === "upload") {
          /* Keeping the existing stored file — metadata only. */
          r = await updateSummaryAction(lang, { ...base, source: "upload" });
        } else {
          r = await updateSummaryAction(lang, {
            ...base,
            source: "content",
            content: values.content,
          });
        }
        if (!r.ok) {
          showToast(errorText(r.errorKey));
          return;
        }
        router.refresh();
        pushActivity("edit", values.title);
        showToast(t.toast.updated);
        setEditing(null);
      } finally {
        end();
      }
    },
    [begin, end, errorText, lang, pushActivity, router, showToast, t],
  );

  const onSaveExam = useCallback(
    async (subjectId: string, id: string, values: ExamFormValues) => {
      if (!begin()) return;
      try {
        const base = { subjectId, id, type: values.type, year: values.year, semester: values.semester };
        let r: ExamActionResult;
        if (values.file) {
          const upload = await uploadFile(values.file, "exam");
          if (!upload) {
            showToast(t.errors.upload);
            return;
          }
          r = await updateExamAction(lang, {
            ...base,
            storagePath: upload.path,
            fileName: upload.fileName,
            mimeType: upload.mimeType,
            fileSize: upload.fileSize,
          });
        } else {
          /* No new file — preserve the existing stored one. */
          r = await updateExamAction(lang, base);
        }
        if (!r.ok) {
          showToast(errorText(r.errorKey));
          return;
        }
        router.refresh();
        pushActivity(
          "edit",
          values.type === "midterm"
            ? t.previousExams.midterm
            : t.previousExams.final,
        );
        showToast(t.toast.updated);
        setEditing(null);
      } finally {
        end();
      }
    },
    [begin, end, errorText, lang, pushActivity, router, showToast, t],
  );

  /* ---- Delete (soft, owner-only, via Server Actions) --------------------- */

  const onRequestDelete = useCallback(
    (target: DeleteTarget | null) => {
      if (target === null) {
        setDeleteTarget(null);
        return;
      }
      if (ownerOf(target) !== currentUserId) return;
      setDeleteTarget(target);
    },
    [ownerOf, currentUserId]
  );

  const onConfirmDelete = useCallback(async () => {
    const target = deleteTarget;
    if (!target) return;
    if (!begin()) return;
    setDeleteTarget(null);
    setEditing(null);
    try {
      if (target.kind === "subject") {
        const r = await deleteSubjectAction(lang, target.id);
        if (!r.ok) {
          showToast(errorText(r.errorKey));
          return;
        }
        if (view.name === "subject" && view.subjectId === target.id) {
          setView({ name: "dashboard" });
        }
      } else if (target.kind === "exam") {
        const r = await deleteExamAction(lang, target.subjectId, target.id);
        if (!r.ok) {
          showToast(errorText(r.errorKey));
          return;
        }
      } else {
        const r = await deleteSummaryAction(lang, target.subjectId, target.id);
        if (!r.ok) {
          showToast(errorText(r.errorKey));
          return;
        }
      }
      router.refresh();
      pushActivity("delete", target.name);
      showToast(t.toast.deleted);
    } finally {
      end();
    }
  }, [begin, deleteTarget, end, errorText, lang, pushActivity, router, showToast, t, view]);

  /* ---- View navigation --------------------------------------------------- */

  const go = useCallback((next: View) => {
    setView(next);
    setOpenForm(null);
    setEditing(null);
    /* The contribute dashboard and subject workspace swap entirely via state
       (no URL change), so Next's built-in scroll-to-top on navigation never
       fires. Start each destination at the top. */
    window.scrollTo(0, 0);
  }, []);

  const onToggleForm = useCallback((form: OpenForm) => {
    setOpenForm((prev) =>
      prev && JSON.stringify(prev) === JSON.stringify(form) ? null : form
    );
    setEditing(null);
  }, []);

  const onStartEdit = useCallback((edit: EditingState) => {
    setEditing(edit);
    setOpenForm(null);
  }, []);

  /* ---- Render ------------------------------------------------------------ */

  const api: Api = {
    lang,
    t,
    currentUserId,
    busy,
    now,
    view,
    subjects: visible,
    activities,
    openForm,
    editing,
    deleteTarget,
    onOpenSubject: (id) => go({ name: "subject", subjectId: id }),
    onBackToDashboard: () => go({ name: "dashboard" }),
    onToggleForm,
    onStartEdit,
    onCancelEdit: () => setEditing(null),
    onCreateSummary,
    onCreateExam,
    onSaveSubject,
    onSaveSummary,
    onSaveExam,
    onRequestDelete,
    onCloseDelete: () => setDeleteTarget(null),
    onConfirmDelete,
  };

  return (
    <>
      <ContributeView api={api} />
      {toast && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-6 z-[95] mx-auto flex w-max max-w-[90vw] items-center gap-2 rounded-full border border-accent/40 bg-elevated px-5 py-2.5 text-sm font-medium text-foreground shadow-[0_16px_48px_rgba(0,0,0,0.55)]"
        >
          <SparkIcon className="h-4 w-4 shrink-0 text-accent" />
          {toast}
        </div>
      )}
    </>
  );
}
