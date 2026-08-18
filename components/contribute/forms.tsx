"use client";

import { useId, useState } from "react";
import { Field, GhostButton, Panel, PrimaryButton, SmallButton, TextArea, TextInput } from "./primitives";
import { ClipboardIcon, CloseIcon, PlusIcon, SearchIcon, UploadIcon } from "../icons";
import {
  displayName,
  subjectMatches,
  subjectSearchText,
} from "@/lib/content/mock-contributor-data";
import type { ExamType, MockSubject, Semester } from "@/lib/content/mock-contributor-data";
import type {
  ContributeDict,
  ExamFormValues,
  SubjectFormValues,
  SubjectRef,
  SummaryFormValues,
} from "./types";

/* Shared shell: a compact panel with the fields and a cancel + primary
   action row. Keeps every creation flow short — one visible section. */

type FormShellProps = {
  t: ContributeDict;
  canSubmit: boolean;
  submitLabel: string;
  onCancel: () => void;
  children: React.ReactNode;
  hint?: string;
};

function FormShell({ t, canSubmit, submitLabel, onCancel, children, hint }: FormShellProps) {
  return (
    <Panel className="p-5">
      <div className="space-y-4">{children}</div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
        <p className="text-xs text-muted">{hint ?? ""}</p>
        <div className="flex items-center gap-2">
          <GhostButton onClick={onCancel}>{t.actions.cancel}</GhostButton>
          <PrimaryButton type="submit" disabled={!canSubmit}>
            {submitLabel}
          </PrimaryButton>
        </div>
      </div>
    </Panel>
  );
}

/* ---- Shared single-file upload -------------------------------------------
   One "choose a file" flow for every contribution type (summary uploads and
   previous-exam files): a 2 MB cap and base64 data-URL storage, with the
   result reported up through the onFile callback so each form keeps its own
   field state. */

export type FileState = {
  fileName: string;
  fileData: string;
  fileType: string;
  fileSize: number;
  fileError: string | null;
};

export const emptyFileState = (): FileState => ({
  fileName: "",
  fileData: "",
  fileType: "",
  fileSize: 0,
  fileError: null,
});

function FileUploadField({
  t,
  inputId,
  file,
  onFile,
}: {
  t: ContributeDict;
  inputId: string;
  file: FileState;
  onFile: (next: FileState) => void;
}) {
  return (
    <div>
      <label htmlFor={inputId} className="sr-only">
        {t.forms.filePrompt}
      </label>
      <label
        htmlFor={inputId}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center transition-colors ${
          file.fileName
            ? "border-accent/40 bg-accent/5 text-accent"
            : "border-white/15 bg-ink/40 text-muted hover:border-accent/40 hover:text-foreground"
        }`}
      >
        <UploadIcon className="h-5 w-5" />
        <span className="text-sm font-medium">
          {file.fileName
            ? t.forms.fileChosen.replace("{file}", file.fileName)
            : t.forms.filePrompt}
        </span>
      </label>
      <input
        id={inputId}
        type="file"
        className="hidden"
        onChange={(e) => {
          const selected = e.target.files?.[0];
          if (!selected) return;
          if (selected.size > MAX_FILE_BYTES) {
            e.target.value = "";
            onFile({ ...emptyFileState(), fileError: t.forms.fileTooLarge });
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            onFile({
              fileName: selected.name,
              fileData:
                typeof reader.result === "string" ? reader.result : "",
              fileType: selected.type,
              fileSize: selected.size,
              fileError: null,
            });
          };
          reader.onerror = () => {
            onFile({ ...emptyFileState(), fileError: t.forms.fileReadError });
          };
          reader.readAsDataURL(selected);
        }}
      />
      {file.fileError && (
        <p role="alert" className="mt-2 text-xs text-red-300">
          {file.fileError}
        </p>
      )}
    </div>
  );
}

/* ---- Add Subject (name only) --------------------------------------------- */

export function SubjectForm({
  t,
  subjects,
  excludeId,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  t: ContributeDict;
  subjects: MockSubject[];
  excludeId?: string;
  initial?: Partial<SubjectFormValues>;
  submitLabel: string;
  onSubmit: (values: SubjectFormValues) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const nameId = useId();
  const duplicate =
    title.trim().length > 0 &&
    subjects.some(
      (s) => s.id !== excludeId && subjectMatches(s, title),
    );
  const canSubmit = title.trim().length > 0 && !duplicate;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({ title: title.trim() });
      }}
    >
      <FormShell
        t={t}
        canSubmit={canSubmit}
        submitLabel={submitLabel}
        onCancel={onCancel}
        hint={t.trustChip}
      >
        <Field label={t.forms.subjectName} required htmlFor={nameId}>
          <TextInput
            id={nameId}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t.forms.subjectNamePlaceholder}
            autoFocus
            aria-invalid={duplicate}
          />
        </Field>
        {duplicate && (
          <p role="alert" className="text-xs text-red-300">
            {t.forms.subjectDuplicate}
          </p>
        )}
      </FormShell>
    </form>
  );
}

/* ---- Add Summary ----------------------------------------------------------
   Final contribution flow:

   Add Summary
   → Choose an existing material (from the community store or the committee
     library) OR Add New Material
   → Summary title
   → Write/paste summary OR upload file
   → Attach YouTube videos if available (optional, multiple URLs allowed)
   → Publish
   ------------------------------------------------------------------------- */

/* One selectable row in the "existing material" list — a catalog subject.
   searchText carries both localized names (already case-folded) so the live
   filter matches English and Arabic alike. */
type MaterialOption = {
  key: string;
  subjectId: string;
  title: string;
  searchText: string;
};

/* Prototype upload cap: a data URL is base64 (~+33%) and the whole store is
   persisted to localStorage (~5 MB), so this keeps a single file safely
   within the budget while staying honest about the prototype's limits. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function SummaryForm({
  t,
  lang,
  subjects,
  initial,
  fixedSubjectId,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  t: ContributeDict;
  lang: string;
  subjects: MockSubject[];
  initial?: Partial<SummaryFormValues>;
  /* The subject this form is bound to. When opened from inside an already
     open subject the subject is fixed: the picker is replaced by read-only
     context and the summary is always stored under this id. Absent → the
     generic flow where the contributor picks or creates a subject. */
  fixedSubjectId?: string;
  submitLabel: string;
  onSubmit: (subjectRef: SubjectRef, values: SummaryFormValues) => void;
  onCancel: () => void;
}) {
  const fixedSubject = fixedSubjectId
    ? subjects.find((s) => s.id === fixedSubjectId)
    : undefined;

  /* Every catalog subject is selectable; a live search filters the visible
     list by either the English or the Arabic name (case-insensitive). */
  const options: MaterialOption[] = subjects.map((subject) => ({
    key: `subject:${subject.id}`,
    subjectId: subject.id,
    title: displayName(subject.title, subject.titleAr, lang),
    searchText: subjectSearchText(subject),
  }));
  const hasExisting = options.length > 0;
  const preselected = subjects.find((s) => s.id === fixedSubjectId);

  const [mode, setMode] = useState<"existing" | "new">(
    hasExisting ? "existing" : "new"
  );
  const [selectedKey, setSelectedKey] = useState<string>(
    preselected ? `subject:${preselected.id}` : options[0]?.key ?? ""
  );
  const selectedMaterial = options.find((o) => o.key === selectedKey);
  const [materialQuery, setMaterialQuery] = useState("");
  const query = materialQuery.trim().toLowerCase();
  const visibleOptions = !query
    ? options
    : options.filter((o) => o.searchText.includes(query));
  const [newSubjectTitle, setNewSubjectTitle] = useState("");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [source, setSource] = useState<"upload" | "content">(initial?.source ?? "content");
  const [fileName, setFileName] = useState(initial?.fileName ?? "");
  const [fileData, setFileData] = useState(initial?.fileData ?? "");
  const [fileType, setFileType] = useState(initial?.fileType ?? "");
  const [fileSize, setFileSize] = useState(initial?.fileSize ?? 0);
  const [fileError, setFileError] = useState<string | null>(null);
  const [content, setContent] = useState(initial?.content ?? "");
  const [videos, setVideos] = useState<string[]>(
    initial?.videos?.length ? initial.videos : [""]
  );

  /* Optional previous exam attached while creating a NEW subject. Only shown
     in the new-material flow; left empty, subject creation works as before. */
  const [examType, setExamType] = useState<ExamType>("midterm");
  const [examYear, setExamYear] = useState("");
  const [examYearUnknown, setExamYearUnknown] = useState(false);
  const [examSemester, setExamSemester] = useState<Semester | "">("");
  const [examFile, setExamFile] = useState<FileState>(emptyFileState());

  const examFileInputId = useId();

  const titleId = useId();
  const contentId = useId();
  const fileInputId = useId();
  const newSubjectId = useId();

  const storeDuplicate =
    mode === "new" && newSubjectTitle.trim().length > 0
      ? subjects.find((s) => subjectMatches(s, newSubjectTitle))
      : undefined;
  const duplicate = storeDuplicate !== undefined;

  const hasSource =
    source === "upload"
      ? fileName.trim().length > 0 && fileData.length > 0
      : content.trim().length > 0;
  const hasSubject = fixedSubject
    ? true
    : mode === "existing"
      ? selectedKey.length > 0
      : newSubjectTitle.trim().length > 0;
  const canSubmit =
    title.trim().length > 0 && hasSource && hasSubject && !duplicate && !fileError;

  /* Whether an optional previous exam was attached (only meaningful when
     creating a NEW subject). The exam is entirely optional and never gates
     publishing. A failed exam upload is ignored rather than blocking. */
  const hasExam =
    examFile.fileName.trim().length > 0 &&
    examFile.fileData.length > 0 &&
    !examFile.fileError;

  const setVideo = (index: number, value: string) =>
    setVideos((prev) => prev.map((v, i) => (i === index ? value : v)));
  const addVideo = () => setVideos((prev) => [...prev, ""]);
  const removeVideo = (index: number) =>
    setVideos((prev) => prev.filter((_, i) => i !== index));

  const tabClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
      active
        ? "border-accent/40 bg-accent/10 text-accent"
        : "border-white/10 bg-white/[0.03] text-muted hover:text-foreground"
    }`;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        const subjectRef: SubjectRef = fixedSubject
          ? { subjectId: fixedSubject.id }
          : mode === "existing" && selectedMaterial
            ? { subjectId: selectedMaterial.subjectId }
            : { title: newSubjectTitle.trim() };
        onSubmit(subjectRef, {
          title: title.trim(),
          source,
          fileName: fileName.trim(),
          fileData: fileData.length > 0 ? fileData : undefined,
          fileType: fileType || undefined,
          fileSize: fileSize > 0 ? fileSize : undefined,
          content: content.trim(),
          videos: videos.map((v) => v.trim()).filter((v) => v.length > 0),
          exam: hasExam
            ? {
                type: examType,
                year: examYearUnknown ? "" : examYear,
                semester: examSemester,
                fileName: examFile.fileName.trim(),
                fileData: examFile.fileData.length > 0 ? examFile.fileData : undefined,
                fileType: examFile.fileType || undefined,
                fileSize: examFile.fileSize > 0 ? examFile.fileSize : undefined,
              }
            : undefined,
        });
      }}
    >
      <FormShell
        t={t}
        canSubmit={canSubmit}
        submitLabel={submitLabel}
        onCancel={onCancel}
        hint={t.forms.summaryHint}
      >
        {/* Subject — fixed when opened from a subject workspace: rendered as
            read-only context, never as a picker. Otherwise the contributor
            chooses an existing material or creates a new one by name only. */}
        {fixedSubject ? (
          <div>
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              {t.workspace.subjectTag}
            </span>
            <p
              dir="auto"
              className="w-full rounded-lg border border-accent/20 bg-accent/[0.04] px-3.5 py-2.5 text-sm text-foreground"
            >
              {displayName(fixedSubject.title, fixedSubject.titleAr, lang)}
            </p>
          </div>
        ) : hasExisting ? (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-foreground">
              {t.forms.subjectChoose}
            </legend>
            <div className="space-y-2" role="radiogroup" aria-label={t.forms.subjectChoose}>
              <label
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm transition-colors ${
                  mode === "existing"
                    ? "border-accent/40 bg-accent/[0.06]"
                    : "border-white/10 bg-white/[0.02] hover:border-white/20"
                }`}
              >
                <input
                  type="radio"
                  name="subject-mode"
                  className="accent-[#2DD4BF]"
                  checked={mode === "existing"}
                  onChange={() => setMode("existing")}
                />
                <span className="font-medium text-foreground">
                  {t.forms.subjectExisting}
                </span>
              </label>
              {mode === "existing" && (
                <div className="ms-5 space-y-2">
                  <div className="relative">
                    <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                    <input
                      type="text"
                      dir="auto"
                      value={materialQuery}
                      onChange={(e) => setMaterialQuery(e.target.value)}
                      placeholder={t.forms.subjectSearch}
                      aria-label={t.forms.subjectSearch}
                      className="w-full rounded-lg border border-white/10 bg-white/[0.02] py-2 ps-9 pe-3 text-sm text-foreground placeholder:text-muted/60 transition-colors focus:border-accent/50 focus:outline-none"
                    />
                  </div>
                  {visibleOptions.length === 0 ? (
                    <p className="px-1 text-xs text-muted">
                      {t.forms.subjectSearchEmpty}
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {visibleOptions.map((option) => (
                        <li key={option.key}>
                          <label
                            className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3.5 py-2 text-sm transition-colors ${
                              selectedKey === option.key
                                ? "border-accent/40 bg-accent/[0.06] text-foreground"
                                : "border-white/10 bg-white/[0.02] text-muted hover:text-foreground"
                            }`}
                          >
                            <input
                              type="radio"
                              name="subject-id"
                              className="accent-[#2DD4BF]"
                              checked={selectedKey === option.key}
                              onChange={() => setSelectedKey(option.key)}
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {option.title}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <label
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm transition-colors ${
                  mode === "new"
                    ? "border-accent/40 bg-accent/[0.06]"
                    : "border-white/10 bg-white/[0.02] hover:border-white/20"
                }`}
              >
                <input
                  type="radio"
                  name="subject-mode"
                  className="accent-[#2DD4BF]"
                  checked={mode === "new"}
                  onChange={() => setMode("new")}
                />
                <span className="font-medium text-foreground">
                  {t.forms.subjectNew}
                </span>
              </label>
              {mode === "new" && (
                <div className="ms-5 space-y-2">
                  <Field label={t.forms.subjectNewName} required htmlFor={newSubjectId}>
                    <TextInput
                      id={newSubjectId}
                      value={newSubjectTitle}
                      onChange={(e) => setNewSubjectTitle(e.target.value)}
                      placeholder={t.forms.subjectNewNamePlaceholder}
                    />
                  </Field>
                  {storeDuplicate && (
                    <div className="space-y-2">
                      <p role="alert" className="text-xs text-red-300">
                        {t.forms.subjectDuplicate}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setMode("existing");
                          setSelectedKey(`subject:${storeDuplicate.id}`);
                        }}
                        className="text-xs font-medium text-accent underline underline-offset-2 transition-colors hover:text-foreground"
                      >
                        {t.forms.subjectDuplicateSelect}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </fieldset>
        ) : (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-foreground">
              {t.forms.subjectNewName}
            </legend>
            <Field label={t.forms.subjectName} required htmlFor={newSubjectId}>
              <TextInput
                id={newSubjectId}
                value={newSubjectTitle}
                onChange={(e) => setNewSubjectTitle(e.target.value)}
                placeholder={t.forms.subjectNewNamePlaceholder}
                autoFocus
              />
            </Field>
            <p className="mt-2 text-xs text-muted">{t.forms.noSubjectsYet}</p>
          </fieldset>
        )}

        {/* Summary title */}
        <Field label={t.forms.summaryTitle} required htmlFor={titleId}>
          <TextInput
            id={titleId}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t.forms.summaryTitlePlaceholder}
          />
        </Field>

        {/* Write/paste OR upload */}
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t.forms.sourceTabContent}>
          <button
            type="button"
            role="tab"
            aria-selected={source === "content"}
            onClick={() => setSource("content")}
            className={tabClass(source === "content")}
          >
            <ClipboardIcon className="h-3.5 w-3.5" />
            {t.forms.sourceTabContent}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={source === "upload"}
            onClick={() => setSource("upload")}
            className={tabClass(source === "upload")}
          >
            <UploadIcon className="h-3.5 w-3.5" />
            {t.forms.sourceTabUpload}
          </button>
        </div>

        {source === "content" ? (
          <Field label={t.forms.summaryContent} required htmlFor={contentId}>
            <TextArea
              id={contentId}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t.forms.contentPlaceholder}
            />
          </Field>
        ) : (
          <FileUploadField
            t={t}
            inputId={fileInputId}
            file={{ fileName, fileData, fileType, fileSize, fileError }}
            onFile={(f) => {
              setFileName(f.fileName);
              setFileData(f.fileData);
              setFileType(f.fileType);
              setFileSize(f.fileSize);
              setFileError(f.fileError);
            }}
          />
        )}

        {/* Optional YouTube videos — multiple URLs allowed */}
        <div>
          <span className="mb-1.5 flex items-baseline justify-between gap-2 text-sm font-medium text-foreground">
            {t.forms.videos}
          </span>
          <div className="space-y-2">
            {videos.map((video, index) => (
              <div key={index} className="flex items-center gap-2">
                <TextInput
                  dir="ltr"
                  value={video}
                  onChange={(e) => setVideo(index, e.target.value)}
                  placeholder={t.forms.videosPlaceholder}
                  aria-label={`${t.forms.videos} ${index + 1}`}
                />
                <SmallButton
                  variant="ghost"
                  onClick={() => removeVideo(index)}
                  aria-label={t.forms.removeVideo}
                  disabled={videos.length === 1 && video.trim().length === 0}
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </SmallButton>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <GhostButton className="!px-3.5 !py-1.5 text-xs" onClick={addVideo}>
              <PlusIcon className="h-3.5 w-3.5" />
              {t.forms.addVideo}
            </GhostButton>
            <p className="text-xs text-muted">{t.forms.videosHint}</p>
          </div>
        </div>

        {/* Optional previous exam — only when creating a NEW subject. Lets the
            contributor attach a previous exam in the same flow instead of
            Create subject → Open subject → Add exam. Completely optional. */}
        {mode === "new" && (
          <fieldset className="rounded-lg border border-white/10 p-4">
            <legend className="px-1 text-sm font-medium text-foreground">
              {t.forms.attachExam}
            </legend>
            <div className="space-y-4">
              <div>
                <span className="mb-1.5 block text-sm font-medium text-foreground">
                  {t.forms.examType}
                </span>
                <div
                  className="grid gap-2 sm:grid-cols-2"
                  role="radiogroup"
                  aria-label={t.forms.examType}
                >
                  {(["midterm", "final"] as const).map((option) => (
                    <label
                      key={option}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm transition-colors ${
                        examType === option
                          ? "border-accent/40 bg-accent/[0.06]"
                          : "border-white/10 bg-white/[0.02] hover:border-white/20"
                      }`}
                    >
                      <input
                        type="radio"
                        name="attach-exam-type"
                        className="accent-[#2DD4BF]"
                        checked={examType === option}
                        onChange={() => setExamType(option)}
                      />
                      <span className="font-medium text-foreground">
                        {option === "midterm"
                          ? t.previousExams.midterm
                          : t.previousExams.final}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={t.forms.year}
                  optionalLabel={t.actions.optional}
                  htmlFor={`${examFileInputId}-year`}
                >
                  <TextInput
                    id={`${examFileInputId}-year`}
                    dir="ltr"
                    value={examYear}
                    disabled={examYearUnknown}
                    onChange={(e) => setExamYear(e.target.value)}
                    placeholder={t.forms.yearPlaceholder}
                  />
                </Field>
                <Field
                  label={t.forms.semester}
                  optionalLabel={t.actions.optional}
                  htmlFor={`${examFileInputId}-semester`}
                >
                  <select
                    id={`${examFileInputId}-semester`}
                    value={examSemester}
                    onChange={(e) =>
                      setExamSemester(e.target.value as Semester | "")
                    }
                    className="w-full rounded-lg border border-white/10 bg-ink/60 px-3.5 py-2.5 text-sm text-foreground transition-colors focus:border-accent/50 focus:outline-none"
                  >
                    <option value="">{t.forms.semesterUnknown}</option>
                    <option value="first">{t.previousExams.semesters.first}</option>
                    <option value="second">{t.previousExams.semesters.second}</option>
                    <option value="summer">{t.previousExams.semesters.summer}</option>
                  </select>
                </Field>
              </div>

              <div>
                <label className="mb-2 inline-flex cursor-pointer items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    className="accent-[#2DD4BF]"
                    checked={examYearUnknown}
                    onChange={(e) => {
                      setExamYearUnknown(e.target.checked);
                      if (e.target.checked) setExamYear("");
                    }}
                  />
                  {t.forms.yearUnknown}
                </label>
                <Field
                  label={t.forms.examFile}
                  optionalLabel={t.actions.optional}
                  htmlFor={examFileInputId}
                >
                  <FileUploadField
                    t={t}
                    inputId={examFileInputId}
                    file={examFile}
                    onFile={setExamFile}
                  />
                </Field>
              </div>
            </div>
          </fieldset>
        )}
      </FormShell>
    </form>
  );
}

/* ---- Add Previous Exam ----------------------------------------------------
   A previous exam attaches to one specific material — the form is always
   opened from that subject's workspace, so the subject is fixed and the
   contributor only describes the exam: type (midterm/final), an optional
   academic year and semester, and the exam file itself.
   ------------------------------------------------------------------------- */

export function ExamForm({
  t,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  t: ContributeDict;
  initial?: Partial<ExamFormValues>;
  submitLabel: string;
  onSubmit: (values: ExamFormValues) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<ExamType>(initial?.type ?? "midterm");
  const [year, setYear] = useState(initial?.year ?? "");
  /* Year is optional: left empty it stores as unknown. The checkbox is an
     explicit "this exam's year isn't known" marker that clears the input. */
  const [yearUnknown, setYearUnknown] = useState(false);
  const [semester, setSemester] = useState<Semester | "">(
    initial?.semester ?? ""
  );
  const [file, setFile] = useState<FileState>(() => ({
    fileName: initial?.fileName ?? "",
    fileData: initial?.fileData ?? "",
    fileType: initial?.fileType ?? "",
    fileSize: initial?.fileSize ?? 0,
    fileError: null,
  }));

  const yearId = useId();
  const semesterId = useId();
  const fileInputId = useId();

  const hasFile = file.fileName.trim().length > 0 && file.fileData.length > 0;
  const canSubmit = hasFile && !file.fileError;

  const typeOptionClass = (selected: boolean) =>
    `flex cursor-pointer items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm transition-colors ${
      selected
        ? "border-accent/40 bg-accent/[0.06]"
        : "border-white/10 bg-white/[0.02] hover:border-white/20"
    }`;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({
          type,
          year: yearUnknown ? "" : year,
          semester,
          fileName: file.fileName.trim(),
          fileData: file.fileData.length > 0 ? file.fileData : undefined,
          fileType: file.fileType || undefined,
          fileSize: file.fileSize > 0 ? file.fileSize : undefined,
        });
      }}
    >
      <FormShell
        t={t}
        canSubmit={canSubmit}
        submitLabel={submitLabel}
        onCancel={onCancel}
        hint={t.forms.examHint}
      >
        {/* Type — midterm or final */}
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-foreground">
            {t.forms.examType}
            <span aria-hidden="true" className="ms-1 text-accent">
              *
            </span>
          </legend>
          <div
            className="grid gap-2 sm:grid-cols-2"
            role="radiogroup"
            aria-label={t.forms.examType}
          >
            {(["midterm", "final"] as const).map((option) => (
              <label key={option} className={typeOptionClass(type === option)}>
                <input
                  type="radio"
                  name="exam-type"
                  className="accent-[#2DD4BF]"
                  checked={type === option}
                  onChange={() => setType(option)}
                />
                <span className="font-medium text-foreground">
                  {option === "midterm"
                    ? t.previousExams.midterm
                    : t.previousExams.final}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Academic year — optional, "unknown" allowed */}
        <div>
          <Field
            label={t.forms.year}
            optionalLabel={t.actions.optional}
            htmlFor={yearId}
          >
            <TextInput
              id={yearId}
              dir="ltr"
              value={year}
              disabled={yearUnknown}
              onChange={(e) => setYear(e.target.value)}
              placeholder={t.forms.yearPlaceholder}
            />
          </Field>
          <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              className="accent-[#2DD4BF]"
              checked={yearUnknown}
              onChange={(e) => {
                setYearUnknown(e.target.checked);
                if (e.target.checked) setYear("");
              }}
            />
            {t.forms.yearUnknown}
          </label>
        </div>

        {/* Semester — optional, "unknown" allowed */}
        <Field
          label={t.forms.semester}
          optionalLabel={t.actions.optional}
          htmlFor={semesterId}
        >
          <select
            id={semesterId}
            value={semester}
            onChange={(e) => setSemester(e.target.value as Semester | "")}
            className="w-full rounded-lg border border-white/10 bg-ink/60 px-3.5 py-2.5 text-sm text-foreground transition-colors focus:border-accent/50 focus:outline-none"
          >
            <option value="">{t.forms.semesterUnknown}</option>
            <option value="first">{t.previousExams.semesters.first}</option>
            <option value="second">{t.previousExams.semesters.second}</option>
            <option value="summer">{t.previousExams.semesters.summer}</option>
          </select>
        </Field>

        {/* Exam file — required */}
        <Field label={t.forms.examFile} required htmlFor={fileInputId}>
          <FileUploadField t={t} inputId={fileInputId} file={file} onFile={setFile} />
        </Field>
      </FormShell>
    </form>
  );
}
