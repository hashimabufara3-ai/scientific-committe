"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  authorName,
  displayName,
  isOwnedByMe,
} from "@/lib/content/mock-contributor-data";
import type { MockSubject, MockSummary } from "@/lib/content/mock-contributor-data";
import Reveal from "./reveal";
import SectionHeading from "./section-heading";
import { ArrowRightIcon, DownloadIcon, ExternalLinkIcon } from "./icons";
import { FileCard, useYouTubeTitles } from "./material-contributions";
import type {
  ContributorFile,
  MaterialContributionsStrings,
} from "./material-contributions";

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

/* Public summary detail page. `subject` and `summary` are the server-resolved
   active rows (metadata only, via getSubject/getSummary), passed down from the
   page — the component no longer reads the browser content store. A missing /
   inactive summary is handled by the page (notFound) before rendering. */
export default function SummaryDetail({
  lang,
  subject,
  summary,
  categoryLabel,
  strings,
}: {
  lang: string;
  subject: MockSubject;
  summary: MockSummary;
  categoryLabel?: string;
  strings: SummaryDetailStrings;
}) {
  const videoUrls = useMemo(() => summary.videos ?? [], [summary]);
  const youtubeTitles = useYouTubeTitles(videoUrls);

  const subjectTitle = displayName(subject.title, subject.titleAr, lang);

  const title = displayName(summary.title, summary.titleAr, lang);
  const description =
    summary.description ??
    (summary.source === "content" && summary.content
      ? summary.content.split("\n")[0]
      : undefined);

  /* An uploaded file (production: fetched via a signed URL through `access`). */
  const file: ContributorFile | null =
    summary.source === "upload" && summary.fileName
      ? {
          id: `${summary.id}-${summary.fileName}`,
          title: summary.title,
          fileName: summary.fileName,
          access: summary.access,
          fileType: summary.fileType,
          fileSize: summary.fileSize,
          owner: isOwnedByMe(summary.authorId)
            ? strings.contributions.you
            : authorName(summary.authorId, lang as "en" | "ar"),
        }
      : null;

  /* A static (committee) file reference — the bytes live at fileUrl, so the
     row shows the file name and metadata with a working View link. */
  const legacyFile =
    summary.source === "upload" &&
    summary.fileName &&
    summary.fileUrl &&
    !summary.access
      ? {
          id: `${summary.id}-${summary.fileName}`,
          fileName: summary.fileName,
          fileUrl: summary.fileUrl,
          fileType: summary.fileType,
          sizeLabel: summary.fileSizeLabel,
          pages: summary.pages,
        }
      : null;

  const externalResources = summary.externalResources ?? [];

  return (
    <main id="main-content" className="mx-auto max-w-4xl px-4 pb-24 sm:px-6">
      <Reveal>
        <nav className="pt-20 sm:pt-28" aria-label={strings.navResources}>
          <Link
            href={`/${lang}/summaries/${subject.id}`}
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

      {summary.source === "content" && summary.content && (
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
              {summary.content}
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

      {(externalResources.length > 0 || videoUrls.length > 0) && (
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
            {videoUrls.map((url, index) => (
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
