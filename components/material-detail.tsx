"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  displayName,
  visibleSummaries,
} from "@/lib/content/mock-contributor-data";
import type { MockSubject } from "@/lib/content/mock-contributor-data";
import Reveal from "./reveal";
import SectionHeading from "./section-heading";
import PreviousExamsSection from "./previous-exams-section";
import type { PreviousExamsStrings } from "./previous-exams-section";
import { ArrowRightIcon } from "./icons";

export type Category = { id: string; label: string };

export type MaterialDetailStrings = {
  navResources: string;
  back: string;
  files: string;
  filesSubtitle: string;
  readFile: string;
  exams: PreviousExamsStrings;
};

/* Public material detail page. `subject` is the server-resolved active catalog
   row (metadata only, via getSubject), passed down from the page — the
   component no longer reads the browser content store. A missing/inactive
   subject is handled by the page (notFound) before rendering. */
export default function MaterialDetail({
  lang,
  subject,
  categories,
  strings,
}: {
  lang: string;
  subject: MockSubject;
  categories: Category[];
  strings: MaterialDetailStrings;
}) {
  const summaries = useMemo(
    () =>
      visibleSummaries(subject).map((s) => ({
        id: s.id,
        title: displayName(s.title, s.titleAr, lang),
        description: s.description
          ? s.description
          : s.content
            ? s.content.split("\n")[0]
            : "",
        href: `/${lang}/summaries/${subject.id}/${s.id}`,
      })),
    [subject, lang],
  );

  const title = displayName(subject.title, subject.titleAr, lang);
  const categoryLabel =
    categories.find((c) => c.id === subject.category)?.label ??
    subject.category ??
    "general";

  return (
    <main id="main-content" className="mx-auto max-w-4xl px-4 pb-24 sm:px-6">
      <Reveal>
        <nav className="pt-20 sm:pt-28" aria-label={strings.navResources}>
          <Link
            href={`/${lang}/summaries`}
            className="inline-flex items-center gap-2 text-sm font-medium text-muted transition-colors hover:text-accent"
          >
            <ArrowRightIcon className="h-4 w-4 rotate-180 rtl-flip" />
            {strings.back}
          </Link>
        </nav>
      </Reveal>

      <Reveal delay={0.05}>
        <header className="mt-8 border-b border-white/10 pb-10">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
              {categoryLabel}
            </span>
          </div>

          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {title}
          </h1>
        </header>
      </Reveal>

      {summaries.length > 0 && (
        <section className="mt-20" aria-label={strings.files}>
          <Reveal>
            <SectionHeading
              kicker={categoryLabel}
              title={strings.files}
              subtitle={strings.filesSubtitle}
            />
          </Reveal>
          <div className="mt-8 space-y-4">
            {summaries.map((summary, index) => (
              <Reveal key={summary.id} delay={(index % 3) * 0.07}>
                <Link
                  href={summary.href}
                  className="block rounded-xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-accent/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-lg font-semibold text-foreground">
                        {summary.title}
                      </h3>
                      {summary.description && (
                        <p className="mt-2 text-sm text-muted">
                          {summary.description}
                        </p>
                      )}
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent">
                      {strings.readFile}
                      <ArrowRightIcon className="h-4 w-4 rtl-flip" />
                    </span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </section>
      )}

      <PreviousExamsSection subject={subject} strings={strings.exams} />
    </main>
  );
}
