"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import ResourceStage from "./resource-stage";
import type { StageItem } from "./resource-stage";
import { SearchIcon } from "./icons";
import {
  displayName,
  subjectChildCounts,
  subjectSearchText,
} from "@/lib/content/mock-contributor-data";
import type { MockSubject } from "@/lib/content/mock-contributor-data";

type Category = { id: string; label: string };

type StageStrings = {
  hint: string;
  filter: string;
  flip: string;
  back: string;
  open: string;
  of: string;
  prev: string;
  next: string;
};

export type StoreCountStrings = {
  summary: string;
  summaries: string;
};

export type LibraryGridStrings = {
  empty: string;
  emptyHint: string;
  emptyAction: string;
  counts: StoreCountStrings;
  search: string;
  noResults: string;
};

/* The Summaries page renders exactly the Contribute catalog (the shared
   content store): every visible subject becomes one card, nothing else. The
   search matches the same bilingual names the Contribute selector matches, so
   the two pages always agree. */
export default function UnifiedLibrary({
  subjects,
  categories,
  stageStrings,
  libraryStrings,
  lang,
  children,
}: {
  subjects: MockSubject[];
  categories: Category[];
  stageStrings: StageStrings;
  libraryStrings: LibraryGridStrings;
  lang: string;
  children?: ReactNode;
}) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredItems = useMemo<StageItem[]>(() => {
    const query = searchQuery.trim().toLowerCase();
    const list = !query
      ? subjects
      : subjects.filter((subject) => subjectSearchText(subject).includes(query));
    return list.map((subject, index) => ({
      id: subject.id,
      title: displayName(subject.title, subject.titleAr, lang),
      categoryLabel:
        categories.find((c) => c.id === subject.category)?.label ?? "",
      count: subjectChildCounts(subject).summaries,
      number: String(index + 1).padStart(2, "0"),
    }));
  }, [subjects, searchQuery, categories, lang]);

  return (
    <div className="relative">
      {children}

      <section className="mx-auto mt-20 max-w-6xl px-4 sm:px-6">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute start-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            dir="auto"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={libraryStrings.search}
            aria-label={libraryStrings.search}
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] py-3 ps-11 pe-4 text-sm text-foreground placeholder:text-muted/60 transition-colors focus:border-accent/50 focus:outline-none"
          />
        </div>

        {filteredItems.length === 0 ? (
          searchQuery.trim() ? (
            <p className="mt-24 text-center text-sm text-muted">
              {libraryStrings.noResults}
            </p>
          ) : (
            <div className="mt-24 text-center">
              <p className="text-base font-semibold text-foreground">
                {libraryStrings.empty}
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
                {libraryStrings.emptyHint}
              </p>
              <Link href={`/${lang}/contact`} className="btn-ghost mt-6">
                {libraryStrings.emptyAction}
              </Link>
            </div>
          )
        ) : (
          <ResourceStage
            items={filteredItems}
            strings={stageStrings}
            counts={libraryStrings.counts}
            lang={lang}
          />
        )}
      </section>
    </div>
  );
}
