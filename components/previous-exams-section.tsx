"use client";

import { useMemo } from "react";
import Reveal from "./reveal";
import SectionHeading from "./section-heading";
import { visibleExams } from "@/lib/content/mock-contributor-data";
import type {
  MockExam,
  MockSubject,
} from "@/lib/content/mock-contributor-data";
import {
  downloadResource,
  fileKind,
  fileSizeLabel,
  openFileInTab,
  openResource,
} from "./file-utils";
import {
  CalendarIcon,
  DownloadIcon,
  EyeIcon,
  FilePdfIcon,
  FileTextIcon,
  ImageIcon,
} from "./icons";

export type PreviousExamsStrings = {
  kicker: string;
  title: string;
  subtitle: string;
  midterm: string;
  final: string;
  unknownYear: string;
  unknownSemester: string;
  semesters: { first: string; second: string; summer: string };
  empty: string;
  download: string;
  view: string;
};

/* The public "Previous Exams" section on a material's detail page: every
   exam shared by contributors for that material, rendered as file cards with
   working Download/View actions — the same file-card language as the
   contributor downloads section above it. A material with no exams yet shows
   a calm empty state instead of nothing at all. */

function ExamCard({
  exam,
  strings,
}: {
  exam: MockExam;
  strings: PreviousExamsStrings;
}) {
  const kind = fileKind(exam.fileType);
  const Icon =
    kind === "pdf" ? FilePdfIcon : kind === "image" ? ImageIcon : FileTextIcon;
  const size = fileSizeLabel(exam.fileSize);
  const type =
    exam.type === "midterm" ? strings.midterm : strings.final;
  const year = exam.year ?? strings.unknownYear;
  const semester = exam.semester
    ? strings.semesters[exam.semester]
    : strings.unknownSemester;
  const canView =
    kind === "pdf" || kind === "image" || exam.fileType === "text/plain";
  const href = exam.fileData || exam.fileUrl;

  const open = () => {
    if (exam.access) {
      void openResource(exam.access.kind, exam.access.id);
    } else if (exam.fileData) {
      openFileInTab(exam.fileData);
    } else if (exam.fileUrl) {
      window.open(exam.fileUrl, "_blank", "noopener");
    }
  };

  const handleDownload = () => {
    if (exam.access) {
      void downloadResource(exam.access.kind, exam.access.id, exam.fileName);
    }
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-accent/40">
      <div className="flex items-start gap-4">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 text-accent">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-accent/25 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">
              {type}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-muted">
              <CalendarIcon className="h-3 w-3" />
              <span dir="ltr">{year}</span>
            </span>
          </div>
          <p className="mt-2 text-xs text-muted">{semester}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <span
              className="max-w-full truncate font-mono"
              dir="ltr"
              title={exam.fileName}
            >
              {exam.fileName}
            </span>
            {size && (
              <>
                <span aria-hidden="true" className="text-white/20">
                  ·
                </span>
                <span dir="ltr">{size}</span>
              </>
            )}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
        {exam.access ? (
          <button
            type="button"
            onClick={handleDownload}
            className="btn-primary !px-4 !py-2 !text-xs motion-safe:active:scale-[0.97]"
          >
            <DownloadIcon className="h-4 w-4" />
            {strings.download}
          </button>
        ) : (
          href && (
            <a
              href={href}
              download={exam.fileName}
              className="btn-primary !px-4 !py-2 !text-xs motion-safe:active:scale-[0.97]"
            >
              <DownloadIcon className="h-4 w-4" />
              {strings.download}
            </a>
          )
        )}
        {canView && (href || exam.access) && (
          <button
            type="button"
            onClick={open}
            className="btn-ghost !px-4 !py-2 !text-xs motion-safe:active:scale-[0.97]"
          >
            <EyeIcon className="h-4 w-4" />
            {strings.view}
          </button>
        )}
      </div>
    </div>
  );
}

export default function PreviousExamsSection({
  subject,
  strings,
}: {
  subject: MockSubject | undefined;
  strings: PreviousExamsStrings;
}) {
  const exams = useMemo(
    () => (subject ? visibleExams(subject) : []),
    [subject]
  );

  return (
    <section
      aria-label={strings.title}
      className="mt-20 border-t border-white/10 pt-12"
    >
      <Reveal>
        <SectionHeading
          kicker={strings.kicker}
          title={strings.title}
          subtitle={strings.subtitle}
        />
      </Reveal>
      {exams.length === 0 ? (
        <Reveal>
          <div className="mt-8 rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center text-sm text-muted">
            {strings.empty}
          </div>
        </Reveal>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {exams.map((exam, index) => (
            <Reveal key={exam.id} delay={(index % 2) * 0.07} className="h-full">
              <ExamCard exam={exam} strings={strings} />
            </Reveal>
          ))}
        </div>
      )}
    </section>
  );
}
