"use client";

import { useEffect, useState } from "react";
import { fmt } from "./contribute/primitives";
import {
  downloadResource,
  fileKind,
  fileSizeLabel,
  openFileInTab,
  openResource,
} from "./file-utils";
import {
  DownloadIcon,
  EyeIcon,
  FilePdfIcon,
  FileTextIcon,
  ImageIcon,
} from "./icons";

export type MaterialContributionsStrings = {
  kicker: string;
  filesTitle: string;
  filesSubtitle: string;
  sourcesTitle: string;
  sourcesSubtitle: string;
  addedBy: string;
  you: string;
  download: string;
  view: string;
  watch: string;
  youtubeFallback: string;
};

/* ---- YouTube title resolution ---------------------------------------------
   Titles are a progressive enhancement: resolved client-side from YouTube's
   oEmbed endpoint (no API key, CORS-open) and cached module-wide so re-renders
   and repeat visits never refetch. Resolution failure never blocks anything —
   the card simply shows the localized fallback. */

const youtubeTitleCache = new Map<string, string>();
const youtubeTitlePending = new Set<string>();

async function resolveYouTubeTitle(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as { title?: string };
    return typeof data.title === "string" && data.title.trim().length > 0
      ? data.title
      : undefined;
  } catch {
    return undefined;
  }
}

export function useYouTubeTitles(urls: string[]): Map<string, string> {
  /* A content-stable key: the array identity changes on every render, but the
     joined URLs only change when the material's videos actually change. */
  const urlKey = urls.join("\u0000");
  const [titles, setTitles] = useState<Map<string, string>>(() => {
    const initial = new Map<string, string>();
    for (const url of urls) {
      const cached = youtubeTitleCache.get(url);
      if (cached) initial.set(url, cached);
    }
    return initial;
  });

  useEffect(() => {
    let cancelled = false;
    for (const url of urls) {
      if (youtubeTitleCache.has(url) || youtubeTitlePending.has(url)) continue;
      youtubeTitlePending.add(url);
      void resolveYouTubeTitle(url).then((title) => {
        youtubeTitlePending.delete(url);
        if (cancelled || !title) return;
        youtubeTitleCache.set(url, title);
        setTitles((prev) => {
          if (prev.get(url) === title) return prev;
          const next = new Map(prev);
          next.set(url, title);
          return next;
        });
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey]);

  return titles;
}

/* ---- File card helpers ---------------------------------------------------- */

export type ContributorFile = {
  id: string;
  /* The contribution/summary title — the file card's primary title. */
  title: string;
  fileName: string;
  /* Legacy prototype bytes. In production this is absent and `access` is set
     instead — the card fetches the file on demand via a signed URL. */
  fileData?: string;
  fileType?: string;
  fileSize?: number;
  owner: string;
  /* Production access descriptor: fetch a short-lived signed URL for this
     stored object when the user chooses View or Download. */
  access?: { kind: "summary" | "exam"; id: string };
};

export function FileCard({
  file,
  strings,
}: {
  file: ContributorFile;
  strings: MaterialContributionsStrings;
}) {
  const kind = fileKind(file.fileType);
  const Icon =
    kind === "pdf" ? FilePdfIcon : kind === "image" ? ImageIcon : FileTextIcon;
  const size = fileSizeLabel(file.fileSize);
  const canView =
    kind === "pdf" || kind === "image" || file.fileType === "text/plain";
  const usingAccess = Boolean(file.access);
  const hasFile = Boolean(file.fileData || file.access);

  const handleDownload = () => {
    if (!file.access) return;
    void downloadResource(file.access.kind, file.access.id, file.fileName);
  };
  const handleView = () => {
    if (file.access) {
      void openResource(file.access.kind, file.access.id);
    } else if (file.fileData) {
      openFileInTab(file.fileData);
    }
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-accent/40">
      <div className="flex items-start gap-4">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 text-accent">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-snug text-foreground" dir="auto">
            {file.title}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
            <span className="max-w-full truncate font-mono" dir="ltr" title={file.fileName}>
              {file.fileName}
            </span>
            <span aria-hidden="true" className="text-white/20">
              ·
            </span>
            <span>{fmt(strings.addedBy, { name: file.owner })}</span>
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
        {usingAccess ? (
          <button
            type="button"
            onClick={handleDownload}
            className="btn-primary !px-4 !py-2 !text-xs motion-safe:active:scale-[0.97]"
          >
            <DownloadIcon className="h-4 w-4" />
            {strings.download}
          </button>
        ) : (
          hasFile && (
            <a
              href={file.fileData}
              download={file.fileName}
              className="btn-primary !px-4 !py-2 !text-xs motion-safe:active:scale-[0.97]"
            >
              <DownloadIcon className="h-4 w-4" />
              {strings.download}
            </a>
          )
        )}
        {canView && hasFile && (
          <button
            type="button"
            onClick={handleView}
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
