"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isOwnedByMe,
  subjectMatches,
  visibleSubjects,
} from "@/lib/content/mock-contributor-data";
import type { ActivityEvent, ActivityKind } from "@/lib/content/mock-contributor-data";
import {
  createSubject,
  createSummary,
  createExam,
  removeSubject,
  removeSummary,
  removeExam,
  updateSubject,
  updateSummary,
  updateExam,
  useContentStore,
} from "@/lib/content/content-store";
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

/* The entire contributor prototype lives in this one client component: it
   reads/writes the shared content store (the same source the public Resources
   pages consume), keeps client-side view navigation, inline add/edit forms,
   soft-delete with dependency warnings, and a lightweight activity + toast
   layer. No backend, no persistence of its own — the store persists to
   localStorage so a published subject is visible in /resources. */

export default function ContributorDashboard({
  lang,
  t,
}: {
  lang: string;
  t: ContributeDict;
}) {
  const subjects = useContentStore();
  /* Activity feed starts empty — only real user actions are recorded via
     pushActivity(). */
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [view, setView] = useState<View>({ name: "dashboard" });
  const [openForm, setOpenForm] = useState<OpenForm>(null);
  const [editing, setEditing] = useState<EditingState>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(0);
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

  const visible = useMemo(() => visibleSubjects(subjects), [subjects]);

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

  const ownerOf = (target: DeleteTarget): string | undefined => {
    const subject = subjects.find((s) =>
      target.kind === "subject" ? s.id === target.id : s.id === target.subjectId
    );
    if (!subject) return undefined;
    if (target.kind === "subject") return subject.authorId;
    if (target.kind === "exam") {
      return subject.exams.find((e) => e.id === target.id)?.authorId;
    }
    return subject.summaries.find((m) => m.id === target.id)?.authorId;
  };

  /* ---- Create ------------------------------------------------------------ */

  const onCreateSummary = useCallback(
    (subjectRef: SubjectRef, values: SummaryFormValues) => {
      /* Resolve the material this summary attaches to:
         - a picked catalog subject id → that subject;
         - a brand-new material name → a new subject, reusing an existing
           one (matched in either language) instead of creating a duplicate. */
      let subjectId = subjectRef.subjectId;
      if (!subjectId && subjectRef.title) {
        const existing = subjects.find((s) =>
          subjectMatches(s, subjectRef.title!)
        );
        subjectId = existing?.id ?? createSubject(subjectRef.title);
      }
      if (!subjectId) return;
      createSummary(subjectId, values);
      /* Optional previous exam attached during subject creation — persisted
         onto the (possibly just-created) subject in the same flow. */
      if (values.exam) createExam(subjectId, values.exam);
      pushActivity("summary", values.title);
      if (values.videos.length > 0) pushActivity("video");
      showToast(t.toast.createdSummary);
      setOpenForm(null);
      setEditing(null);
      setView({ name: "subject", subjectId });
    },
    [pushActivity, showToast, subjects, t.toast.createdSummary]
  );

  const onCreateExam = useCallback(
    (subjectId: string, values: ExamFormValues) => {
      if (!subjectId) return;
      createExam(subjectId, values);
      pushActivity(
        "exam",
        values.type === "midterm"
          ? t.previousExams.midterm
          : t.previousExams.final
      );
      showToast(t.toast.createdExam);
      setOpenForm(null);
      setEditing(null);
    },
    [pushActivity, showToast, t.previousExams.midterm, t.previousExams.final, t.toast.createdExam]
  );

  /* ---- Edit -------------------------------------------------------------- */

  const onSaveSubject = useCallback(
    (id: string, values: SubjectFormValues) => {
      updateSubject(id, values.title, lang);
      pushActivity("edit", values.title);
      showToast(t.toast.updated);
      setEditing(null);
    },
    [lang, pushActivity, showToast, t.toast.updated]
  );

  const onSaveSummary = useCallback(
    (subjectId: string, id: string, values: SummaryFormValues) => {
      updateSummary(subjectId, id, values);
      pushActivity("edit", values.title);
      showToast(t.toast.updated);
      setEditing(null);
    },
    [pushActivity, showToast, t.toast.updated]
  );

  const onSaveExam = useCallback(
    (subjectId: string, id: string, values: ExamFormValues) => {
      updateExam(subjectId, id, values);
      pushActivity(
        "edit",
        values.type === "midterm"
          ? t.previousExams.midterm
          : t.previousExams.final
      );
      showToast(t.toast.updated);
      setEditing(null);
    },
    [pushActivity, showToast, t.previousExams.midterm, t.previousExams.final, t.toast.updated]
  );

  /* ---- Delete (soft, owner-only, with dependency warning) ---------------- */

  const onRequestDelete = useCallback(
    (target: DeleteTarget | null) => {
      if (target === null) {
        setDeleteTarget(null);
        return;
      }
      if (!isOwnedByMe(ownerOf(target) ?? "")) return;
      setDeleteTarget(target);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subjects]
  );

  const onConfirmDelete = useCallback(() => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    setEditing(null);

    if (target.kind === "subject") {
      removeSubject(target.id);
      if (view.name === "subject" && view.subjectId === target.id) {
        setView({ name: "dashboard" });
      }
    } else if (target.kind === "exam") {
      removeExam(target.subjectId, target.id);
    } else {
      removeSummary(target.subjectId, target.id);
    }

    pushActivity("delete", target.name);
    showToast(t.toast.deleted);
  }, [deleteTarget, view, pushActivity, showToast, t.toast.deleted]);

  /* ---- View navigation --------------------------------------------------- */

  const go = useCallback((next: View) => {
    setView(next);
    setOpenForm(null);
    setEditing(null);
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
