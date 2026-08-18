"use client";

import { useEffect, useMemo, useState } from "react";
import Reveal from "./reveal";
import SectionHeading from "./section-heading";
import { useContentStore, useHydrated } from "@/lib/content/content-store";
import {
  authorName,
  isOwnedByMe,
  visibleSummaries,
} from "@/lib/content/mock-contributor-data";
import { fmt } from "./contribute/primitives";
import { fileKind, fileSizeLabel, openFileInTab } from "./file-utils";
import {
  DownloadIcon,
  ExternalLinkIcon,
  EyeIcon,
  FilePdfIcon,
  FileTextIcon,
  ImageIcon,
  VideoIcon,
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

/* Contributor content on a material's public detail page, rendered as exactly
   two ordinary content sections in the same design language as the rest of
   the resource page:

       Material
       ├── Downloads (every uploaded contributor file)
       └── External Sources (every contributed YouTube link)

   "Summary" stays an internal submission concept — the contributor publishes
   with "Add Summary", but the public page never frames content by it. Uploaded
   files surface as real file cards with a working Download/Open action (the
   file bytes persist as a data URL in the shared store — MockSummary.fileData).
   YouTube links surface as source cards whose title is the resolved video
   title (or a clean fallback), never the raw URL.

   Hydration safety: contributor content only exists in the browser's
   localStorage, so nothing renders until the session has loaded — the SSR
   seed HTML and the first client render can never disagree. */

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
  fileData: string;
  fileType?: string;
  fileSize?: number;
  owner: string;
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
        <a
          href={file.fileData}
          download={file.fileName}
          className="btn-primary !px-4 !py-2 !text-xs motion-safe:active:scale-[0.97]"
        >
          <DownloadIcon className="h-4 w-4" />
          {strings.download}
        </a>
        {canView && (
          <button
            type="button"
            onClick={() => openFileInTab(file.fileData)}
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

/* ---- The two public contributor sections ---------------------------------- */

export default function MaterialContributions({
  lang,
  subjectId,
  strings,
}: {
  lang: string;
  subjectId?: string;
  strings: MaterialContributionsStrings;
}) {
  const subjects = useContentStore();
  const hydrated = useHydrated();

  const subject = subjectId
    ? subjects.find((s) => !s.deleted && s.id === subjectId)
    : undefined;

  /* Every YouTube URL across all of the material's contributions, read as one
     list — the same way the library's video count is the total of its
     contributors' videos. */
  const videoUrls = useMemo(
    () =>
      subject
        ? visibleSummaries(subject).flatMap((s) =>
            (s.videos ?? []).map((url) => url)
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subject?.id, subject?.summaries]
  );
  const youtubeTitles = useYouTubeTitles(videoUrls);

  if (!hydrated) return null;

  /* Nothing contributed to this material yet — a plain material has no extra
     sections at all. */
  if (!subject) return null;

  const owner = (id: string) =>
    isOwnedByMe(id) ? strings.you : authorName(id, lang as "en" | "ar");

  /* Every uploaded file across all of the material's contributions. */
  const files = subject.summaries
    .filter((s) => !s.deleted)
    .flatMap<ContributorFile>((s) =>
      s.source === "upload" && s.fileName && s.fileData
        ? [
            {
              id: `${s.id}-${s.fileName}`,
              title: s.title,
              fileName: s.fileName,
              fileData: s.fileData,
              fileType: s.fileType,
              fileSize: s.fileSize,
              owner: owner(s.authorId),
            },
          ]
        : []
    );

  const sources = videoUrls.map((url, index) => ({
    id: `${index}-${url}`,
    url,
    title: youtubeTitles.get(url) ?? strings.youtubeFallback,
  }));

  if (files.length === 0 && sources.length === 0) return null;

  return (
    <>
      {files.length > 0 && (
        <section
          aria-label={strings.filesTitle}
          className="mt-20 border-t border-white/10 pt-12"
        >
          <Reveal>
            <SectionHeading
              kicker={strings.kicker}
              title={strings.filesTitle}
              subtitle={strings.filesSubtitle}
            />
          </Reveal>
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {files.map((file, index) => (
              <Reveal key={file.id} delay={(index % 2) * 0.07} className="h-full">
                <FileCard file={file} strings={strings} />
              </Reveal>
            ))}
          </div>
        </section>
      )}

      {sources.length > 0 && (
        <section
          aria-label={strings.sourcesTitle}
          className="mt-20 border-t border-white/10 pt-12"
        >
          <Reveal>
            <SectionHeading
              kicker={strings.kicker}
              title={strings.sourcesTitle}
              subtitle={strings.sourcesSubtitle}
            />
          </Reveal>
          <ul className="mt-8 space-y-3">
            {sources.map((source) => (
              <li key={source.id}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-4 rounded-xl border border-dashed border-accent/30 bg-accent/[0.04] p-4 transition-colors hover:border-accent/60 hover:bg-accent/[0.08]"
                >
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
                    <VideoIcon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {source.title}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                      <span className="inline-flex items-center gap-1.5 font-medium text-accent">
                        <VideoIcon className="h-3.5 w-3.5" />
                        YouTube
                      </span>
                      <span aria-hidden="true" className="text-white/20">
                        ·
                      </span>
                      <span className="max-w-full truncate" dir="ltr">
                        {source.url}
                      </span>
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-accent">
                    {strings.watch}
                    <ExternalLinkIcon className="h-4 w-4" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
