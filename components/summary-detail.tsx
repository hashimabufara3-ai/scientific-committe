"use client";

import Link from "next/link";
import { notFound } from "next/navigation";
import { useMemo } from "react";
import { useContentStore, useHydrated } from "@/lib/content/content-store";
import {
  authorName,
  displayName,
  isOwnedByMe,
  visibleSubjects,
  visibleSummaries,
} from "@/lib/content/mock-contributor-data";
import Reveal from "./reveal";
import SectionHeading from "./section-heading";
import { ArrowRightIcon, DownloadIcon, ExternalLinkIcon } from "./icons";
import { FileCard, useYouTubeTitles } from "./material-contributions";
import type {
  ContributorFile,
  MaterialContributionsStrings,
} from "./material-contributions";
import { findStoreSubject } from "./material-detail";
import type { Category } from "./material-detail";

export type SummaryDetailStrings = {
  navResources: string;
  backToSubject: string;
  files: string;
  filesSubtitle: string;
  uploadedBy: string;
  pages: string;
  view: string;
  externalResources: string;
  externalResourcesSubtitle: string;
  watch: string;
  contributions: MaterialContributionsStrings;
};

export default function SummaryDetail({
  lang,
  urlId,
  summaryId,
  categories,
  strings,
}: {
  lang: string;
  urlId: string;
  summaryId: string;
  categories: Category[];
  strings: SummaryDetailStrings;
}) {
  const subjects = visibleSubjects(useContentStore());
  const hydrated = useHydrated();

  const storeSubject = useMemo(
    () => findStoreSubject(subjects, urlId),
    [subjects, urlId],
  );

  const storeSummary = useMemo(
    () =>
      storeSubject
        ? visibleSummaries(storeSubject).find((s) => s.id === summaryId) ??
          null
        : null,
    [storeSubject, summaryId],
  );

  const videoUrls = useMemo(
    () => (storeSummary ? storeSummary.videos : []),
    [storeSummary],
  );
  const youtubeTitles = useYouTubeTitles(videoUrls);

  /* Store content only exists in the browser session: hold a plain shell until
     the store has hydrated, then 404 for ids that resolve to nothing. */
  if (hydrated && !storeSummary) notFound();

  const subjectTitle = storeSubject
    ? displayName(storeSubject.title, storeSubject.titleAr, lang)
    : "";
  const categoryLabel =
    storeSubject &&
    (categories.find((c) => c.id === storeSubject.category)?.label ??
      storeSubject.category ??
      "general");

  if (!storeSummary) {
    return <main id="main-content" className="mx-auto max-w-4xl px-4 pb-24 sm:px-6" />;
  }

  const title = displayName(storeSummary.title, storeSummary.titleAr, lang);
  const description =
    storeSummary.description ??
    (storeSummary.source === "content" && storeSummary.content
      ? storeSummary.content.split("\n")[0]
      : undefined);

  const file: ContributorFile | null =
    storeSummary.source === "upload" &&
    storeSummary.fileName &&
    storeSummary.fileData
      ? {
          id: `${storeSummary.id}-${storeSummary.fileName}`,
          title: storeSummary.title,
          fileName: storeSummary.fileName,
          fileData: storeSummary.fileData,
          fileType: storeSummary.fileType,
          fileSize: storeSummary.fileSize,
          owner: isOwnedByMe(storeSummary.authorId)
            ? strings.contributions.you
            : authorName(storeSummary.authorId, lang as "en" | "ar"),
        }
      : null;

  /* A static (committee) file reference — the bytes live at fileUrl, so the
     row shows the file name and metadata with a working View link. */
  const legacyFile =
    storeSummary.source === "upload" &&
    storeSummary.fileName &&
    storeSummary.fileUrl &&
    !storeSummary.fileData
      ? {
          id: `${storeSummary.id}-${storeSummary.fileName}`,
          fileName: storeSummary.fileName,
          fileUrl: storeSummary.fileUrl,
          fileType: storeSummary.fileType,
          sizeLabel: storeSummary.fileSizeLabel,
          pages: storeSummary.pages,
        }
      : null;

  const externalResources = storeSummary.externalResources ?? [];

  return (
    <main id="main-content" className="mx-auto max-w-4xl px-4 pb-24 sm:px-6">
      <Reveal>
        <nav className="pt-20 sm:pt-28" aria-label={strings.navResources}>
          <Link
            href={`/${lang}/resources/${urlId}`}
            className="inline-flex items-center gap-2 text-sm font-medium text-muted transition-colors hover:text-accent"
          >
            <ArrowRightIcon className="h-4 w-4 rotate-180 rtl-flip" />
            {strings.backToSubject}
          </Link>
        </nav>
      </Reveal>

      <Reveal delay={0.05}>
        <header className="mt-8 border-b border-white/10 pb-10">
          {categoryLabel && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                {categoryLabel}
              </span>
            </div>
          )}
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {title}
          </h1>
          {subjectTitle && title !== subjectTitle && (
            <p className="mt-3 text-sm text-muted">{subjectTitle}</p>
          )}
          {description && (
            <p className="mt-4 text-base leading-relaxed text-muted">
              {description}
            </p>
          )}
        </header>
      </Reveal>

      {storeSummary.source === "content" && storeSummary.content && (
        <section className="mt-20" aria-label={strings.files}>
          <Reveal>
            <SectionHeading
              kicker={categoryLabel ?? ""}
              title={strings.files}
              subtitle={strings.filesSubtitle}
            />
          </Reveal>
          <Reveal delay={0.05}>
            <div className="mt-8 whitespace-pre-wrap rounded-xl border border-white/10 bg-white/[0.03] p-6 text-base leading-relaxed text-foreground">
              {storeSummary.content}
            </div>
          </Reveal>
        </section>
      )}

      {file && (
        <section className="mt-20" aria-label={strings.files}>
          <Reveal>
            <SectionHeading
              kicker={categoryLabel ?? ""}
              title={strings.files}
              subtitle={strings.filesSubtitle}
            />
          </Reveal>
          <div className="mt-8">
            <FileCard file={file} strings={strings.contributions} />
          </div>
        </section>
      )}

      {legacyFile && (
        <section className="mt-20" aria-label={strings.files}>
          <Reveal>
            <SectionHeading
              kicker={categoryLabel ?? ""}
              title={strings.files}
              subtitle={strings.filesSubtitle}
            />
          </Reveal>
          <Reveal delay={0.05}>
            <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-semibold text-foreground">
                    {legacyFile.fileName}
                  </h3>
                  <p className="mt-2 text-sm text-muted">
                    {strings.uploadedBy} {strings.contributions.you}
                    {legacyFile.sizeLabel && (
                      <> · {legacyFile.sizeLabel}</>
                    )}
                    {legacyFile.pages
                      ? <> · {legacyFile.pages} {strings.pages}</>
                      : null}
                  </p>
                </div>
                <a
                  href={legacyFile.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/20"
                >
                  <DownloadIcon className="h-4 w-4" />
                  {strings.view}
                </a>
              </div>
            </div>
          </Reveal>
        </section>
      )}

      {(externalResources.length > 0 ||
        (storeSummary && storeSummary.videos.length > 0)) && (
        <section
          className="mt-20"
          aria-label={strings.externalResources}
        >
          <Reveal>
            <SectionHeading
              kicker={categoryLabel ?? ""}
              title={strings.externalResources}
              subtitle={strings.externalResourcesSubtitle}
            />
          </Reveal>
          <div className="mt-8 space-y-4">
            {externalResources.map((resource, index) => (
              <Reveal key={resource.id} delay={(index % 3) * 0.07}>
                <Link
                  href={resource.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-accent/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-lg font-semibold text-foreground">
                        {resource.title}
                      </h3>
                      <p className="mt-2 text-sm text-muted">
                        {resource.type === "youtube" ? "YouTube" : resource.type}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent">
                      {strings.watch}
                      <ExternalLinkIcon className="h-4 w-4" />
                    </span>
                  </div>
                </Link>
              </Reveal>
            ))}
            {storeSummary?.videos.map((url, index) => (
              <Reveal key={url} delay={((externalResources.length + index) % 3) * 0.07}>
                <Link
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-accent/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-lg font-semibold text-foreground">
                        {youtubeTitles.get(url) ??
                          strings.contributions.youtubeFallback}
                      </h3>
                      <p className="mt-2 text-sm text-muted">YouTube</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent">
                      {strings.watch}
                      <ExternalLinkIcon className="h-4 w-4" />
                    </span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
