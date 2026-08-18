"use client";

import { useEffect, useId, useRef } from "react";
import { TrashIcon } from "../icons";
import { fmt } from "./primitives";
import type { ContributeDict, DeleteTarget } from "./types";

/* Destructive-action confirmation. The copy is filled in per target type and,
   for subjects, states exactly how much dependent content would disappear —
   that is the "responsibility" half of the contribution model. */

export function DeleteDialog({
  t,
  target,
  onCancel,
  onConfirm,
}: {
  t: ContributeDict;
  target: DeleteTarget;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const countLabel = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;

  let title = "";
  let body = "";

  if (target.kind === "subject") {
    title = fmt(t.delete.title, { name: target.name });
    const parts = [
      target.counts.summaries > 0
        ? countLabel(target.counts.summaries, t.workspace.counts.summary, t.workspace.counts.summaries)
        : null,
      target.counts.videos > 0
        ? countLabel(target.counts.videos, t.workspace.counts.video, t.workspace.counts.videos)
        : null,
      target.counts.exams > 0
        ? countLabel(target.counts.exams, t.workspace.counts.exam, t.workspace.counts.exams)
        : null,
    ].filter(Boolean) as string[];
    const contents = parts.length > 0 ? parts.join(` ${t.delete.and} `) : t.delete.nothing;
    body = fmt(t.delete.subjectBody, { contents });
  } else if (target.kind === "exam") {
    title = fmt(t.delete.title, { name: target.name });
    body = t.delete.examBody;
  } else {
    title = fmt(t.delete.title, { name: target.name });
    body = t.delete.summaryBody;
  }

  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-ink/80 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="w-full max-w-md rounded-xl border border-white/10 bg-elevated p-6 shadow-[0_24px_64px_rgba(0,0,0,0.55)]"
      >
        <div className="flex items-start gap-4">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-red-400/40 bg-red-500/10 text-red-300">
            <TrashIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-lg font-semibold tracking-tight text-foreground"
            >
              {title}
            </h2>
            <p id={bodyId} className="mt-2 text-sm leading-relaxed text-muted">
              {body}
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="btn-ghost !px-5 !py-2"
          >
            {t.delete.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center gap-2 rounded-full border border-red-400/40 bg-red-500/10 px-5 py-2 text-sm font-semibold text-red-300 transition-colors hover:bg-red-500/20"
          >
            <TrashIcon className="h-4 w-4" />
            {t.delete.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
