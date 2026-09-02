"use client";

import Link from "next/link";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import {
  authorName,
  displayName,
  subjectChildCounts,
  visibleExams,
  visibleSummaries,
} from "@/lib/content/mock-contributor-data";
import type {
  ActivityEvent,
  MockExam,
  MockSubject,
  MockSummary,
} from "@/lib/content/mock-contributor-data";
import type { Role } from "@/lib/auth/roles";
import {
  ArrowRightIcon,
  BookIcon,
  ClipboardIcon,
  ExternalLinkIcon,
  FilePdfIcon,
  PencilIcon,
  PlusIcon,
  SparkIcon,
  TrashIcon,
  UsersIcon,
  VideoIcon,
} from "../icons";
import { DeleteDialog } from "./delete-dialog";
import { ExamForm, SubjectForm, SummaryForm } from "./forms";
import {
  AccentChip,
  Chip,
  fmt,
  GhostButton,
  Kicker,
  Panel,
  PrimaryButton,
  SectionTitle,
} from "./primitives";
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

/* Everything the dashboard hands its views. All state lives in the parent
   client component; the views are pure render functions over it. */

export type Api = {
  lang: string;
  t: ContributeDict;
  /* The authenticated, server-resolved id of the signed-in contributor. Used
     for ownership gating instead of the mock "me" constant. */
  currentUserId: string;
  /* The authenticated user's role (contributor/admin/owner). Admins and
     owners may manage any contributor's content; contributors manage their
     own only. The server/RPC layer remains the authoritative gate. */
  currentRole: Role;
  /* True while an upload / server action is running (disables submits). */
  busy: boolean;
  /* Current upload phase (null when there is no file upload in flight). */
  uploadPhase: UploadPhase | null;
  now: number;
  view: View;
  subjects: MockSubject[];
  activities: ActivityEvent[];
  openForm: OpenForm;
  editing: EditingState;
  deleteTarget: DeleteTarget | null;
  onOpenSubject: (id: string) => void;
  onBackToDashboard: () => void;
  onToggleForm: (form: OpenForm) => void;
  onStartEdit: (edit: EditingState) => void;
  onCancelEdit: () => void;
  onCreateSummary: (subjectRef: SubjectRef, values: SummaryFormValues) => void;
  onCreateExam: (subjectId: string, values: ExamFormValues) => void;
  onSaveSubject: (id: string, values: SubjectFormValues) => void;
  onSaveSummary: (subjectId: string, id: string, values: SummaryFormValues) => void;
  onSaveExam: (subjectId: string, id: string, values: ExamFormValues) => void;
  onRequestDelete: (target: DeleteTarget) => void;
  onCloseDelete: () => void;
  onConfirmDelete: () => void;
};

/* ---- Small shared bits --------------------------------------------------- */

function countPhrase(
  n: number,
  unit: "summary" | "video" | "exam",
  t: ContributeDict
) {
  const c = t.workspace.counts;
  const label =
    n === 1
      ? c[unit]
      : c[
          unit === "summary"
            ? "summaries"
            : unit === "video"
              ? "videos"
              : "exams"
        ];
  return `${n} ${label}`;
}

/* A compact, localized label for a previous exam: the type always, then the
   academic year and semester when known — e.g. "Midterm · 2024/2025 · First". */
function examLabel(exam: MockExam, t: ContributeDict): string {
  const type =
    exam.type === "midterm"
      ? t.previousExams.midterm
      : t.previousExams.final;
  const parts = [type];
  if (exam.year) parts.push(exam.year);
  if (exam.semester) parts.push(t.previousExams.semesters[exam.semester]);
  return parts.join(" · ");
}

function timeAgo(ts: number, now: number, t: ContributeDict) {
  if (now <= 0) return "";
  const diff = Math.max(0, now - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t.activity.time.justNow;
  if (minutes < 60) return fmt(t.activity.time.minutes, { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return fmt(t.activity.time.hours, { n: hours });
  const days = Math.floor(hours / 24);
  return fmt(t.activity.time.days, { n: days });
}

function isOwned(authorId: string | undefined, currentUserId: string): boolean {
  return Boolean(authorId && authorId === currentUserId);
}

/* Whether the current actor may edit/delete a given row. Contributors manage
   only their own rows; admins and owners may manage any contributor's rows.
   This is a UI capability alignment — the server RPCs are the authoritative
   security layer and enforce the same rules independently. */
function canManage(
  owned: boolean,
  currentRole: Role
): boolean {
  return owned || currentRole === "admin" || currentRole === "owner";
}

function ownerName(
  authorId: string,
  lang: string,
  t: ContributeDict,
  currentUserId: string
) {
  return isOwned(authorId, currentUserId)
    ? t.you
    : authorName(authorId, lang as "en" | "ar");
}

/* Edit / delete for content the current contributor owns (or admin/owner may
   manage any contributor's content). stopPropagation is handled here so these
   can sit inside clickable cards. */
function RowActions({
  owned,
  currentRole,
  onEdit,
  onDelete,
  t,
}: {
  owned: boolean;
  currentRole: Role;
  onEdit?: () => void;
  onDelete: () => void;
  t: ContributeDict;
}) {
  if (!canManage(owned, currentRole)) return null;
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {onEdit && (
        <GhostButton
          className="!px-3 !py-1.5 !text-xs motion-safe:active:scale-[0.97]"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          aria-label={t.actions.edit}
        >
          <PencilIcon className="h-3.5 w-3.5" />
          <span>{t.actions.edit}</span>
        </GhostButton>
      )}
      <GhostButton
        className="!px-3 !py-1.5 !text-xs !border-red-400/40 !bg-red-500/10 !text-red-300 hover:!bg-red-500/20 motion-safe:active:scale-[0.97]"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label={t.actions.delete}
      >
        <TrashIcon className="h-3.5 w-3.5" />
        <span>{t.actions.delete}</span>
      </GhostButton>
    </div>
  );
}

/* Clickable card: a div with button semantics so inner action buttons can
   stop propagation (a <button> cannot nest buttons). */
function Pressable({
  onClick,
  onKeyDown,
  children,
  className = "",
}: {
  onClick: () => void;
  onKeyDown: (e: ReactKeyboardEvent) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={`cursor-pointer outline-none ${className}`}
    >
      {children}
    </div>
  );
}

function Breadcrumb({
  items,
  label,
}: {
  items: { label: string; onClick?: () => void; current?: boolean }[];
  label: string;
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-1.5 text-sm">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && (
            <ArrowRightIcon
              aria-hidden="true"
              className="h-3.5 w-3.5 rtl-flip text-white/25"
            />
          )}
          {item.current ? (
            <span className="font-medium text-foreground">{item.label}</span>
          ) : (
            <button
              type="button"
              onClick={item.onClick}
              className="text-muted transition-colors hover:text-accent"
            >
              {item.label}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}

/* ---- Page header --------------------------------------------------------- */

function ContributorHeader({ t, lang }: { t: ContributeDict; lang: string }) {
  return (
    <div className="pb-12 pt-20 sm:pt-28">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
          <UsersIcon className="h-3.5 w-3.5" />
          {t.contributingAs} · {t.you}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-medium text-muted">
          <SparkIcon className="h-3.5 w-3.5 text-accent" />
          {t.trustChip}
        </span>
        <Link
          href={`/${lang}/summaries`}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-accent/40 hover:text-accent"
        >
          {t.viewPublic}
        </Link>
      </div>
      <Kicker>{t.kicker}</Kicker>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        {t.title}
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted">
        {t.subtitle}
      </p>
    </div>
  );
}

/* ---- Activity feed ------------------------------------------------------- */

const ACTIVITY_ICONS = {
  subject: BookIcon,
  summary: ClipboardIcon,
  video: VideoIcon,
  exam: FilePdfIcon,
  edit: PencilIcon,
  delete: TrashIcon,
} as const;

function ActivityFeed({
  activities,
  now,
  t,
}: {
  activities: ActivityEvent[];
  now: number;
  t: ContributeDict;
}) {
  const sorted = [...activities].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);

  return (
    <Panel className="p-5">
      <Kicker>{t.activity.kicker}</Kicker>
      <h3 className="mt-2 text-lg font-semibold tracking-tight text-foreground">
        {t.activity.title}
      </h3>
      <ul className="mt-5 space-y-1">
        {sorted.map((event) => {
          const Icon = ACTIVITY_ICONS[event.kind];
          const message =
            event.kind === "subject" ||
            event.kind === "summary" ||
            event.kind === "exam" ||
            event.kind === "edit" ||
            event.kind === "delete"
              ? fmt(t.activity[event.kind], { title: event.title ?? "" })
              : t.activity[event.kind];
          return (
            <li
              key={event.id}
              className="flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-white/[0.03]"
            >
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-accent">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm text-foreground">{message}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {timeAgo(event.createdAt, now, t)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/* ---- Subject card -------------------------------------------------------- */

function SubjectCard({ subject, api }: { subject: MockSubject; api: Api }) {
  const { t, lang } = api;
  const owned = isOwned(subject.authorId, api.currentUserId);
  const counts = subjectChildCounts(subject);
  const open = () => api.onOpenSubject(subject.id);
  const del = () =>
    api.onRequestDelete({
      kind: "subject",
      id: subject.id,
      name: displayName(subject.title, subject.titleAr, lang),
      counts,
    });

  return (
    <Panel className="p-5 transition-colors hover:border-accent/40">
      <Pressable
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold leading-snug tracking-tight text-foreground">
            {displayName(subject.title, subject.titleAr, lang)}
          </h3>
          <RowActions owned={owned} currentRole={api.currentRole} onDelete={del} t={t} />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted">
            {countPhrase(counts.summaries, "summary", t)} ·{" "}
            {countPhrase(counts.videos, "video", t)} ·{" "}
            {countPhrase(counts.exams, "exam", t)}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3.5 py-1.5 text-xs font-semibold text-accent shadow-[0_0_20px_rgba(45,212,191,0.15)] transition-colors hover:border-accent/60 hover:bg-accent/20 motion-safe:active:scale-[0.97]">
            {t.open}
            <ArrowRightIcon className="h-4 w-4 rtl-flip" />
          </span>
        </div>
      </Pressable>
      <p className="mt-3 border-t border-white/10 pt-3 text-xs text-muted">
        {fmt(t.workspace.addedBy, { name: ownerName(subject.authorId, lang, t, api.currentUserId) })}
      </p>
    </Panel>
  );
}

/* ---- Dashboard ----------------------------------------------------------- */

function DashboardView({ api }: { api: Api }) {
  const { t, subjects } = api;
  const stats = { subjects: 0, summaries: 0, videos: 0 };
  for (const s of subjects) {
    const c = subjectChildCounts(s);
    stats.subjects += 1;
    stats.summaries += c.summaries;
    stats.videos += c.videos;
  }

  /* The subject-card edit button (and its dashboard rename form) was removed;
     subject renaming remains available in the subject workspace. */

  return (
    <div>
      <ContributorHeader t={t} lang={api.lang} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Panel className="p-5">
          <div className="flex items-center gap-2 text-muted">
            <BookIcon className="h-4 w-4 text-accent" />
            <span className="text-sm font-medium">{t.stats.subjects}</span>
          </div>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
            {stats.subjects}
          </p>
        </Panel>
        <Panel className="p-5">
          <div className="flex items-center gap-2 text-muted">
            <ClipboardIcon className="h-4 w-4 text-accent" />
            <span className="text-sm font-medium">{t.stats.summaries}</span>
          </div>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
            {stats.summaries}
          </p>
        </Panel>
        <Panel className="p-5">
          <div className="flex items-center gap-2 text-muted">
            <VideoIcon className="h-4 w-4 text-accent" />
            <span className="text-sm font-medium">{t.stats.videos}</span>
          </div>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
            {stats.videos}
          </p>
        </Panel>
      </div>

      <div className="mt-12 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            {t.subjectsTitle}
          </h2>
          <p className="mt-1 text-sm text-muted">{t.subjectsSubtitle}</p>
        </div>
        <PrimaryButton onClick={() => api.onToggleForm({ kind: "summary" })}>
          <PlusIcon className="h-4 w-4" />
          {t.actions.addSummary}
        </PrimaryButton>
      </div>

      {api.openForm?.kind === "summary" && (
        <div className="mt-6">
          <SummaryForm
            t={t}
            lang={api.lang}
            subjects={api.subjects}
            fixedSubjectId={api.openForm.subjectId}
            submitLabel={t.actions.publish}
            onSubmit={api.onCreateSummary}
            onCancel={() => api.onToggleForm(null)}
            busy={api.busy}
            phase={api.uploadPhase}
          />
        </div>
      )}

      {subjects.length === 0 ? (
        <Panel className="mt-6 p-8 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
            <BookIcon className="h-6 w-6" />
          </span>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            {t.subjectsEmpty}
          </p>
          <div className="mt-5 flex justify-center">
            <PrimaryButton onClick={() => api.onToggleForm({ kind: "summary" })}>
              <PlusIcon className="h-4 w-4" />
              {t.actions.addSummary}
            </PrimaryButton>
          </div>
        </Panel>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {subjects.map((subject) => (
            <SubjectCard key={subject.id} subject={subject} api={api} />
          ))}
        </div>
      )}

      <div className="mt-12 grid items-start gap-4 lg:grid-cols-2">
        <MyContributions api={api} />
        <ActivityFeed activities={api.activities} now={api.now} t={t} />
      </div>
    </div>
  );
}

/* ---- My contributions list ----------------------------------------------- */

function MyContributions({ api }: { api: Api }) {
  const { t, subjects, lang } = api;

  const items: {
    key: string;
    kind: "subject" | "summary" | "exam";
    subject: MockSubject;
    summary?: MockSummary;
    exam?: MockExam;
  }[] = [];
  for (const subject of subjects) {
    if (isOwned(subject.authorId, api.currentUserId)) {
      items.push({ key: `subject-${subject.id}`, kind: "subject", subject });
    }
    for (const summary of visibleSummaries(subject)) {
      if (isOwned(summary.authorId, api.currentUserId)) {
        items.push({ key: `summary-${summary.id}`, kind: "summary", subject, summary });
      }
    }
    for (const exam of visibleExams(subject)) {
      if (isOwned(exam.authorId, api.currentUserId)) {
        items.push({ key: `exam-${exam.id}`, kind: "exam", subject, exam });
      }
    }
  }

  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Kicker>{t.contributions.kicker}</Kicker>
          <h3 className="mt-2 text-lg font-semibold tracking-tight text-foreground">
            {t.contributions.title}
          </h3>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="mt-5 text-sm text-muted">{t.contributions.empty}</p>
      ) : (
        <ul className="mt-5 divide-y divide-white/10">
          {items.map((item) => {
            const counts = subjectChildCounts(item.subject);
            return (
              <li key={item.key} className="flex items-center gap-3 py-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-accent">
                  {item.kind === "subject" ? (
                    <BookIcon className="h-4 w-4" />
                  ) : item.kind === "summary" ? (
                    <ClipboardIcon className="h-4 w-4" />
                  ) : (
                    <FilePdfIcon className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => api.onOpenSubject(item.subject.id)}
                    className="block truncate text-sm font-medium text-foreground transition-colors hover:text-accent"
                  >
                    {item.kind === "subject"
                      ? displayName(item.subject.title, item.subject.titleAr, lang)
                      : item.kind === "summary"
                        ? displayName(item.summary?.title ?? "", item.summary?.titleAr, lang)
                        : item.exam
                          ? examLabel(item.exam, t)
                          : ""}
                  </button>
                  <p className="mt-0.5 text-xs text-muted">
                    {item.kind === "subject" ? (
                      <>
                        {countPhrase(counts.summaries, "summary", t)} ·{" "}
                        {countPhrase(counts.videos, "video", t)} ·{" "}
                        {countPhrase(counts.exams, "exam", t)}
                      </>
                    ) : (
                      fmt(t.contributions.inSubject, {
                        subject: displayName(item.subject.title, item.subject.titleAr, lang),
                      })
                    )}
                  </p>
                </div>
                <span className="text-xs text-muted">
                  {fmt(t.workspace.addedBy, { name: ownerName(item.subject.authorId, lang, t, api.currentUserId) })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ---- Inline editing ------------------------------------------------------ */

function SummaryEditInline({
  subjectId,
  initial,
  api,
}: {
  subjectId: string;
  initial: MockSummary;
  api: Api;
}) {
  return (
    <div className="mb-4">
      <SummaryForm
        t={api.t}
        lang={api.lang}
        subjects={api.subjects}
        fixedSubjectId={subjectId}
        initial={initial}
        submitLabel={api.t.actions.save}
        onSubmit={(subjectRef, values) =>
          api.onSaveSummary(subjectId, initial.id, values)
        }
        onCancel={api.onCancelEdit}
        busy={api.busy}
        phase={api.uploadPhase}
      />
    </div>
  );
}

/* ---- Subject workspace --------------------------------------------------- */

function SubjectWorkspace({ subject, api }: { subject: MockSubject; api: Api }) {
  const { t, lang } = api;
  const counts = subjectChildCounts(subject);
  const summaries = visibleSummaries(subject);
  const exams = visibleExams(subject);

  return (
    <div>
      <Breadcrumb
        label={t.nav.breadcrumb}
        items={[
          { label: t.nav.dashboard, onClick: api.onBackToDashboard },
          {
            label: displayName(subject.title, subject.titleAr, lang),
            current: true,
          },
        ]}
      />
      <div className="mt-8">
        <div className="max-w-2xl">
          <Kicker>{t.workspace.subjectTag}</Kicker>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {displayName(subject.title, subject.titleAr, lang)}
          </h1>
          <p className="mt-3 text-sm text-muted">
            {fmt(t.workspace.addedBy, { name: ownerName(subject.authorId, lang, t, api.currentUserId) })}
          </p>
        </div>
      </div>

      {api.editing?.kind === "subject" && api.editing.id === subject.id && (
        <div className="mt-6">
          <SubjectForm
            t={t}
            initial={{ title: subject.title, titleAr: subject.titleAr }}
            submitLabel={t.actions.save}
            onSubmit={(values) => api.onSaveSubject(subject.id, values)}
            onCancel={api.onCancelEdit}
            busy={api.busy}
            phase={api.uploadPhase}
          />
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          <Chip>{countPhrase(counts.summaries, "summary", t)}</Chip>
          <Chip>{countPhrase(counts.videos, "video", t)}</Chip>
          <Chip>{countPhrase(counts.exams, "exam", t)}</Chip>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PrimaryButton
            onClick={() => api.onToggleForm({ kind: "summary", subjectId: subject.id })}
          >
            <PlusIcon className="h-4 w-4" />
            {t.actions.addSummary}
          </PrimaryButton>
          <PrimaryButton
            onClick={() => api.onToggleForm({ kind: "exam", subjectId: subject.id })}
          >
            <FilePdfIcon className="h-4 w-4" />
            {t.actions.addExam}
          </PrimaryButton>
        </div>
      </div>

      {api.openForm?.kind === "summary" && (
        <div className="mt-4">
          <SummaryForm
            t={t}
            lang={api.lang}
            subjects={api.subjects}
            fixedSubjectId={subject.id}
            submitLabel={t.actions.publish}
            onSubmit={api.onCreateSummary}
            onCancel={() => api.onToggleForm(null)}
            busy={api.busy}
            phase={api.uploadPhase}
          />
        </div>
      )}

      {api.openForm?.kind === "exam" && api.openForm.subjectId === subject.id && (
        <div className="mt-4">
          <ExamForm
            t={t}
            submitLabel={t.actions.publish}
            onSubmit={(values) => api.onCreateExam(subject.id, values)}
            onCancel={() => api.onToggleForm(null)}
            busy={api.busy}
            phase={api.uploadPhase}
          />
        </div>
      )}

      <div className="mt-6 space-y-3">
        {summaries.length === 0 ? (
          <Panel className="border-dashed p-8 text-center text-sm text-muted">
            {t.workspace.noSummaries}
          </Panel>
        ) : (
          summaries.map((summary) => (
            <SummaryRow key={summary.id} subjectId={subject.id} summary={summary} api={api} />
          ))
        )}
      </div>

      <div className="mt-12">
        <SectionTitle>{t.previousExams.title}</SectionTitle>
        <div className="mt-4 space-y-3">
          {exams.length === 0 ? (
            <Panel className="border-dashed p-8 text-center text-sm text-muted">
              {t.previousExams.noExams}
            </Panel>
          ) : (
            exams.map((exam) => (
              <ExamRow key={exam.id} subjectId={subject.id} exam={exam} api={api} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- Summary row --------------------------------------------------------- */

function SummaryRow({
  subjectId,
  summary,
  api,
}: {
  subjectId: string;
  summary: MockSummary;
  api: Api;
}) {
  const { t, lang } = api;
  const owned = isOwned(summary.authorId, api.currentUserId);
  const isEditing = api.editing?.kind === "summary" && api.editing.id === summary.id;

  return (
    <Panel className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium leading-snug text-foreground">
            {displayName(summary.title, summary.titleAr, lang)}
          </h3>
          <p className="mt-1 text-xs text-muted">
            {fmt(t.workspace.addedBy, { name: ownerName(summary.authorId, lang, t, api.currentUserId) })}
            {summary.source === "upload" && (
              <>
                <span className="mx-1 text-muted/40">·</span>
                <span className="inline-flex items-center gap-1">
                  <AccentChip>{summary.fileName}</AccentChip>
                </span>
              </>
            )}
          </p>
        </div>
        <RowActions
          owned={owned}
          currentRole={api.currentRole}
          onEdit={() =>
            api.onStartEdit({ kind: "summary", subjectId, id: summary.id })
          }
          onDelete={() =>
            api.onRequestDelete({
              kind: "summary",
              subjectId,
              id: summary.id,
              name: displayName(summary.title, summary.titleAr, lang),
            })
          }
          t={t}
        />
      </div>
      {summary.content && (
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted">
          {summary.content}
        </p>
      )}
      {(summary.videos ?? []).length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-white/10 pt-3">
          {(summary.videos ?? []).map((url, i) => (
            <li key={i}>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex max-w-full items-center gap-1.5 text-xs text-accent underline-offset-2 hover:underline"
              >
                <VideoIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate" dir="ltr">
                  {url}
                </span>
                <ExternalLinkIcon className="h-3 w-3 shrink-0" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {isEditing && (
        <div className="mt-4">
          <SummaryEditInline subjectId={subjectId} initial={summary} api={api} />
        </div>
      )}
    </Panel>
  );
}

/* ---- Previous exam row --------------------------------------------------- */

function ExamRow({
  subjectId,
  exam,
  api,
}: {
  subjectId: string;
  exam: MockExam;
  api: Api;
}) {
  const { t, lang } = api;
  const owned = isOwned(exam.authorId, api.currentUserId);
  const isEditing = api.editing?.kind === "exam" && api.editing.id === exam.id;

  return (
    <Panel className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <AccentChip>
              {exam.type === "midterm"
                ? t.previousExams.midterm
                : t.previousExams.final}
            </AccentChip>
            {exam.year && (
              <Chip>
                <span dir="ltr">{exam.year}</span>
              </Chip>
            )}
            {exam.semester && (
              <Chip>{t.previousExams.semesters[exam.semester]}</Chip>
            )}
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <span
              className="max-w-full truncate font-mono"
              dir="ltr"
              title={exam.fileName}
            >
              {exam.fileName}
            </span>
            <span aria-hidden="true" className="text-muted/40">
              ·
            </span>
            <span>
              {fmt(t.workspace.addedBy, {
                name: ownerName(exam.authorId, lang, t, api.currentUserId),
              })}
            </span>
          </p>
        </div>
        <RowActions
          owned={owned}
          currentRole={api.currentRole}
          onEdit={() =>
            api.onStartEdit({ kind: "exam", subjectId, id: exam.id })
          }
          onDelete={() =>
            api.onRequestDelete({
              kind: "exam",
              subjectId,
              id: exam.id,
              name: examLabel(exam, t),
            })
          }
          t={t}
        />
      </div>
      {isEditing && (
        <div className="mt-4">
          <ExamForm
            t={t}
            initial={{
              type: exam.type,
              year: exam.year ?? "",
              semester: exam.semester ?? "",
              fileName: exam.fileName,
              fileType: exam.fileType,
              fileSize: exam.fileSize,
            }}
            submitLabel={t.actions.save}
            onSubmit={(values) => api.onSaveExam(subjectId, exam.id, values)}
            onCancel={api.onCancelEdit}
            busy={api.busy}
            phase={api.uploadPhase}
          />
        </div>
      )}
    </Panel>
  );
}

/* ---- Root switch --------------------------------------------------------- */

export function ContributeView({ api }: { api: Api }) {
  const dialog =
    api.deleteTarget && (
      <DeleteDialog
        t={api.t}
        target={api.deleteTarget}
        onCancel={api.onCloseDelete}
        onConfirm={api.onConfirmDelete}
        pending={api.busy}
      />
    );
  const view = api.view;
  if (view.name === "dashboard") {
    return (
      <>
        <DashboardView api={api} />
        {dialog}
      </>
    );
  }
  const subject = api.subjects.find((s) => s.id === view.subjectId);
  if (!subject) {
    /* The workspace id is not yet in the fresh server props (a Server Action
       just committed and router.refresh() has not delivered the new catalog —
       refresh() is fire-and-forget in this Next version). Render a stable
       transitional panel instead of a blank screen so the UI never appears
       broken during this window. */
    return (
      <>
        <div className="py-20 text-center text-sm text-muted" aria-live="polite">
          …
        </div>
        {dialog}
      </>
    );
  }
  return (
    <>
      <SubjectWorkspace subject={subject} api={api} />
      {dialog}
    </>
  );
}
