"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ActivityEvent,
  ActivityKind,
  MockSubject,
} from "@/lib/content/mock-contributor-data";
import {
  createNewMaterialAction,
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
  UploadPhase,
  View,
} from "./types";
import { SparkIcon } from "../icons";

/* The contributor workspace.

   Reads are server-fed: `subjects` is the active catalog fetched in
   /[lang]/contribute/page.tsx via getSubjects() (metadata only) and refreshed
   through router.refresh() after every mutation. Mutations go through the
   Server Actions in app/[lang]/contribute/actions.ts — the single place rows
   are written to the database. PDF bytes go DIRECTLY from the browser to the
   private Storage bucket via a short-lived signed upload URL
   (/api/resources/upload-auth); only upload metadata passes through Render.
   The browser never reads a file as a data URL, never stores bytes in
   localStorage, and never sends bytes through a Server Action argument.

   Ownership gating (edit/delete) uses `currentUserId` (the authenticated
   contributor resolved server-side), not a prototype constant.
*/

type UploadResult = {
  path: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
};

/* Why an upload was rejected, so the UI can show a specific localized message
   instead of one generic "could not upload". "type" also covers files whose
   declared MIME or magic bytes are not PDF. */
type UploadFailure = "type" | "size" | "network";

type UploadOutcome =
  | { ok: true; value: UploadResult }
  | { ok: false; reason: UploadFailure };

/* Mirrors RESOURCES_BUCKET in lib/content/storage.ts (server). The bucket is
   PRIVATE; the browser only ever gets a short-lived signed upload URL. */
const RESOURCES_BUCKET = "resources";

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
  /* Current upload sub-step, surfaced to the contributor:
     preparing (requesting authorization) → uploading (direct to Storage) →
     finalizing (server validating + finalizing the stored object). */
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>(null);
  const busyRef = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* IDs of subjects whose delete Server Action already succeeded, but whose
     removal has not yet been confirmed by the router.refresh() RSC round trip.
     Only subjects a contributor successfully deleted are added, and only after
     the authoritative server result. The server assigns unique ids, so an id
     kept here can never match a future subject - the overlay is therefore safe
     to keep without an explicit clear and is a no-op once fresh props arrive. */
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

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
        case "duplicate":
          return t.forms.subjectDuplicate;
        default:
          return t.errors.generic;
      }
    },
    [t.errors, t.forms],
  );

  /* Localized message for an upload rejection reason. */
  const uploadErrorText = useCallback(
    (reason: UploadFailure) => {
      if (reason === "type") return t.forms.unsupportedFileType;
      if (reason === "size") return t.forms.fileTooLarge;
      return t.errors.upload;
    },
    [t],
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
    setUploadPhase(null);
  }, []);

  /* Upload a raw browser File DIRECTLY to the private Storage bucket via a
     short-lived signed upload URL issued by /api/resources/upload-auth. Only
     upload METADATA travels to Render (a few hundred bytes); the 3 MB file body
     goes straight from the browser to Supabase Storage. The server validates
     the actual stored object (size + PDF magic bytes) before any metadata is
     written (finalizeStoredUpload inside the resource Server Actions). The
     server's 422 codes map to the same type/size reasons as before. */
  const uploadFile = useCallback(
    async (file: File, kind: "summary" | "exam"): Promise<UploadOutcome> => {
      setUploadPhase("preparing");
      try {
        /* Best-effort MIME for the metadata request; the PDF gate is still
           enforced server-side on the stored object, not by this string. */
        const mimeType =
          file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : "");
        const res = await fetch("/api/resources/upload-auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind,
            fileName: file.name,
            mimeType,
            size: file.size,
          }),
        });
        if (res.status === 422) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          return {
            ok: false,
            reason: body.error === "too_large" ? "size" : "type",
          };
        }
        if (!res.ok) return { ok: false, reason: "network" };
        const { path, token } = (await res.json()) as {
          path: string;
          token: string;
        };

        setUploadPhase("uploading");
        const { createClient } = await import(
          "../../lib/auth/supabase-browser"
        );
        const supabase = createClient();
        const { error } = await supabase.storage
          .from(RESOURCES_BUCKET)
          .uploadToSignedUrl(path, token, file);
        if (error) return { ok: false, reason: "network" };

        return {
          ok: true,
          value: {
            path,
            fileName: file.name,
            mimeType: mimeType || "application/pdf",
            fileSize: file.size,
          },
        };
      } catch {
        return { ok: false, reason: "network" };
      }
    },
    []
  );

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
        if (subjectRef.subjectId) {
          /* Existing material: attach the summary (and any optional exam) to
             an already-published subject. */
          if (values.source === "upload") {
            if (!values.file) {
              showToast(t.errors.uploadMissing);
              return;
            }
            const upload = await uploadFile(values.file, "summary");
            if (!upload.ok) {
              showToast(uploadErrorText(upload.reason));
              return;
            }
            setUploadPhase("finalizing");
            const created = await createSummaryAction(lang, {
              subjectId: subjectRef.subjectId,
              title: values.title,
              source: "upload",
              storagePath: upload.value.path,
              fileName: upload.value.fileName,
              mimeType: upload.value.mimeType,
              fileSize: upload.value.fileSize,
              videos: values.videos,
            });
            if (!created.ok) {
              showToast(errorText(created.errorKey));
              return;
            }
          } else {
            const created = await createSummaryAction(lang, {
              subjectId: subjectRef.subjectId,
              title: values.title,
              source: "content",
              content: values.content,
              videos: values.videos,
            });
            if (!created.ok) {
              showToast(errorText(created.errorKey));
              return;
            }
          }

          /* Optional previous exam attached to an existing subject —
             best-effort, never gates the summary being published. */
          if (values.exam?.file) {
            const examUpload = await uploadFile(values.exam.file, "exam");
            if (!examUpload.ok) {
              showToast(uploadErrorText(examUpload.reason));
            } else {
              const created = await createExamAction(lang, {
                subjectId: subjectRef.subjectId,
                type: values.exam.type,
                year: values.exam.year,
                semester: values.exam.semester,
                storagePath: examUpload.value.path,
                fileName: examUpload.value.fileName,
                mimeType: examUpload.value.mimeType,
                fileSize: examUpload.value.fileSize,
              });
              if (!created.ok) showToast(errorText(created.errorKey));
            }
          }
        } else if (subjectRef.title) {
          /* BRAND-NEW material: uploads happen first (the atomic RPC needs the
             object paths), then ONE server action creates the subject, its
             first summary and the optional exam inside a single database
             transaction. The subject is never publicly visible before the
             creation commits; on any rejection the action compensates by
             removing the just-uploaded objects. */
          let upload;
          if (values.source === "upload") {
            if (!values.file) {
              showToast(t.errors.uploadMissing);
              return;
            }
            const res = await uploadFile(values.file, "summary");
            if (!res.ok) {
              showToast(uploadErrorText(res.reason));
              return;
            }
            upload = res.value;
          }

          const exam = values.exam;
          let examUpload;
          if (exam?.file) {
            const res = await uploadFile(exam.file, "exam");
            if (!res.ok) showToast(uploadErrorText(res.reason));
            else examUpload = res.value;
          }
          setUploadPhase("finalizing");

          const created = await createNewMaterialAction(lang, {
            title: subjectRef.title,
            titleAr: subjectRef.titleAr,
            summary: {
              title: values.title,
              source: values.source,
              content: values.content,
              videos: values.videos,
              storagePath: upload?.path,
              fileName: upload?.fileName,
              mimeType: upload?.mimeType,
              fileSize: upload?.fileSize,
            },
            exam:
              examUpload && exam
                ? {
                    type: exam.type,
                    year: exam.year,
                    semester: exam.semester,
                    storagePath: examUpload.path,
                    fileName: examUpload.fileName,
                    mimeType: examUpload.mimeType,
                    fileSize: examUpload.fileSize,
                  }
                : undefined,
          });
          if (!created.ok) {
            showToast(errorText(created.errorKey));
            return;
          }

          router.refresh();
          pushActivity("summary", values.title);
          if (values.videos.length > 0) pushActivity("video");
          showToast(t.toast.createdSummary);
          setOpenForm(null);
          setEditing(null);
          /* Navigate to the new subject workspace. router.refresh() is
             fire-and-forget (not awaitable in this Next version); until the
             fresh RSC props land, ContributeView renders a stable transitional
             panel instead of a blank screen for the not-yet-resolved id. */
          if (created.id) setView({ name: "subject", subjectId: created.id });
          return;
        } else {
          return;
        }

        router.refresh();
        pushActivity("summary", values.title);
        if (values.videos.length > 0) pushActivity("video");
        showToast(t.toast.createdSummary);
        setOpenForm(null);
        setEditing(null);
      } finally {
        end();
      }
    },
    [begin, end, errorText, lang, pushActivity, router, showToast, t, uploadErrorText],
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
        if (!upload.ok) {
          showToast(uploadErrorText(upload.reason));
          return;
        }
        setUploadPhase("finalizing");
        const created: ExamActionResult = await createExamAction(lang, {
          subjectId,
          type: values.type,
          year: values.year,
          semester: values.semester,
          storagePath: upload.value.path,
          fileName: upload.value.fileName,
          mimeType: upload.value.mimeType,
          fileSize: upload.value.fileSize,
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
    [begin, end, errorText, lang, pushActivity, router, showToast, t, uploadErrorText],
  );

  /* ---- Edit -------------------------------------------------------------- */

  const onSaveSubject = useCallback(
    async (id: string, values: SubjectFormValues) => {
      if (!begin()) return;
      try {
        const r = await updateSubjectAction(lang, id, values.title, values.titleAr);
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
          if (!upload.ok) {
            showToast(uploadErrorText(upload.reason));
            return;
          }
          setUploadPhase("finalizing");
          r = await updateSummaryAction(lang, {
            ...base,
            source: "upload",
            storagePath: upload.value.path,
            fileName: upload.value.fileName,
            mimeType: upload.value.mimeType,
            fileSize: upload.value.fileSize,
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
    [begin, end, errorText, lang, pushActivity, router, showToast, t, uploadErrorText],
  );

  const onSaveExam = useCallback(
    async (subjectId: string, id: string, values: ExamFormValues) => {
      if (!begin()) return;
      try {
        const base = { subjectId, id, type: values.type, year: values.year, semester: values.semester };
        let r: ExamActionResult;
        if (values.file) {
          const upload = await uploadFile(values.file, "exam");
          if (!upload.ok) {
            showToast(uploadErrorText(upload.reason));
            return;
          }
          setUploadPhase("finalizing");
          r = await updateExamAction(lang, {
            ...base,
            storagePath: upload.value.path,
            fileName: upload.value.fileName,
            mimeType: upload.value.mimeType,
            fileSize: upload.value.fileSize,
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
    [begin, end, errorText, lang, pushActivity, router, showToast, t, uploadErrorText],
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
    setEditing(null);
    /* Keep the confirmation dialog open while the delete Server Action is
       running so the pending state (see `pending` prop) stays visible on the
       confirm button; it is closed only once the delete resolves. On failure
       it stays open so the contributor can retry. */
    try {
      if (target.kind === "subject") {
        const r = await deleteSubjectAction(lang, target.id);
        if (!r.ok) {
          showToast(errorText(r.errorKey));
          return;
        }
        /* Delete succeeded server-side: hide this subject immediately so the
           UI does not wait out the router.refresh() RSC round trip. */
        setRemovedIds((prev) => {
          if (prev.has(target.id)) return prev;
          const next = new Set(prev);
          next.add(target.id);
          return next;
        });
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
      setDeleteTarget(null);
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
    uploadPhase,
    now,
    view,
    /* Locally drop subjects whose delete already succeeded so the card
       disappears immediately after the Server Action returns instead of
       waiting out the router.refresh() RSC round trip. Fresh server props
       remain the source of truth: the removed rows no longer exist server-side,
       so the overlay is a no-op once the RSC payload arrives. */
    subjects: subjects.filter((s) => !removedIds.has(s.id)),
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
      {uploadPhase && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-[4.5rem] z-[95] mx-auto flex w-max max-w-[90vw] items-center gap-2 rounded-full border border-accent/40 bg-elevated px-5 py-2.5 text-sm font-medium text-foreground shadow-[0_16px_48px_rgba(0,0,0,0.55)]"
        >
          <span
            aria-hidden="true"
            className="h-2 w-2 animate-pulse rounded-full bg-accent/70"
          />
          {uploadPhase === "preparing"
            ? t.forms.uploadPreparing
            : uploadPhase === "uploading"
              ? t.forms.uploading
              : t.forms.uploadFinalizing}
        </div>
      )}
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
