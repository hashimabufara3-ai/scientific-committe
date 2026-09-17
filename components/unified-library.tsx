"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ResourceStage from "./resource-stage";
import type { StageItem } from "./resource-stage";
import { SearchIcon } from "./icons";
import { displayName, subjectChildCounts } from "@/lib/content/mock-contributor-data";
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
  pagination: string;
  prev: string;
  next: string;
  pageOf: string;
};

/* The Summaries page renders exactly the Contribute catalog (the shared
   content store): every visible subject becomes one card, nothing else.
   Search and pagination are server-side: `subjects` already contains the
   matching, page-bounded subjects, so this component only renders them and
   drives the URL (search input debounced, pagination links) so the server can
   refetch the appropriate page. */
export default function UnifiedLibrary({
  subjects,
  categories,
  stageStrings,
  libraryStrings,
  lang,
  page,
  totalPages,
  search,
  children,
}: {
  subjects: MockSubject[];
  categories: Category[];
  stageStrings: StageStrings;
  libraryStrings: LibraryGridStrings;
  lang: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  search: string;
  children?: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const hasSearch = !!search.trim();
  const noMatchingSubjects = hasSearch && subjects.length === 0;
  const showGrid = subjects.length > 0 || (!hasSearch && subjects.length === 0);

  /* Server-side search is authoritative: subjects is already the page of
     matches, so no client-side re-filtering is performed. */
  const filteredItems = useMemo<StageItem[]>(
    () =>
      subjects.map((subject, index) => ({
        id: subject.id,
        title: displayName(subject.title, subject.titleAr, lang),
        categoryLabel:
          categories.find((c) => c.id === subject.category)?.label ?? "",
        count: subjectChildCounts(subject).summaries,
        number: String(index + 1).padStart(2, "0"),
      })),
    [subjects, categories, lang]
  );

  /* URL builder for a target page, preserving the active search term. */
  const buildHref = useCallback(
    (targetPage: number, nextSearch?: string) => {
      const params = new URLSearchParams(searchParams.toString());
      const term = (nextSearch ?? search).trim();
      if (term) params.set("search", term);
      else params.delete("search");
      params.set("page", String(targetPage));
      return `${pathname}?${params.toString()}`;
    },
    [pathname, searchParams, search]
  );

  /* Debounced search input that updates the URL (and resets to page 1) while
     the server refetches. The value prop is the committed URL search term. */
  const [inputValue, setInputValue] = useState(search);
  const [previousSearch, setPreviousSearch] = useState(search);
  /* Sync with the committed URL term without writing state in an effect:
     adjust state during render when the prop changes (React's documented
     "adjusting state when a prop changes" pattern). */
  if (previousSearch !== search) {
    setPreviousSearch(search);
    setInputValue(search);
  }

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (inputValue.trim() === search) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      router.replace(buildHref(1, inputValue), { scroll: false });
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [inputValue, search, router, buildHref]);

  /* Pagination — values are server-provided and clamped to a valid range. */
  const currentPage = Math.min(Math.max(1, page), Math.max(1, totalPages));
  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < totalPages;
  const showPagination = totalPages > 1;

  /* Page-number window with ellipsis for large catalogs. */
  const pageNumbers = useMemo<(number | "ellipsis")[]>(() => {
    const out: (number | "ellipsis")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) out.push(i);
    } else {
      out.push(1);
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      if (start > 2) out.push("ellipsis");
      for (let i = start; i <= end; i++) out.push(i);
      if (end < totalPages - 1) out.push("ellipsis");
      out.push(totalPages);
    }
    return out;
  }, [totalPages, currentPage]);

  const pageOfLabel = libraryStrings.pageOf
    .replace("{page}", String(currentPage))
    .replace("{totalPages}", String(totalPages));

  const linkClass =
    "inline-flex items-center justify-center rounded-lg border border-white/10 px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent/50 hover:text-accent";
  const disabledLinkClass =
    "inline-flex items-center justify-center rounded-lg border border-white/10 px-3 py-1.5 text-sm text-muted/40";

  return (
    <div className="relative">
      {children}

      <section className="mx-auto mt-20 max-w-6xl px-4 sm:px-6">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute start-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            dir="auto"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={libraryStrings.search}
            aria-label={libraryStrings.search}
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] py-3 ps-11 pe-4 text-sm text-foreground placeholder:text-muted/60 transition-colors focus:border-accent/50 focus:outline-none"
          />
        </div>

        {/* Empty state when search has content but no results */}
        {noMatchingSubjects && (
          <p className="mt-24 text-center text-sm text-muted">
            {libraryStrings.noResults}
          </p>
        )}

        {/* Empty state when no subjects at all (and no search) */}
        {!hasSearch && subjects.length === 0 && (
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
        )}

        {showGrid && (
          <ResourceStage
            items={filteredItems}
            strings={stageStrings}
            counts={libraryStrings.counts}
            lang={lang}
          />
        )}

        {/* Pagination controls (hidden on a single page) */}
        {showPagination && (
          <nav
            aria-label={libraryStrings.pagination}
            className="mt-12 flex flex-wrap items-center justify-center gap-3"
          >
            {canGoPrevious ? (
              <Link
                href={buildHref(currentPage - 1)}
                aria-label={libraryStrings.prev}
                className={linkClass}
              >
                {libraryStrings.prev}
              </Link>
            ) : (
              <span aria-disabled="true" className={disabledLinkClass}>
                {libraryStrings.prev}
              </span>
            )}

            <ol className="flex items-center gap-1">
              {pageNumbers.map((num, index) =>
                num === "ellipsis" ? (
                  <li
                    key={`ellipsis-${index}`}
                    aria-hidden="true"
                    className="px-1 text-sm text-muted"
                  >
                    ...
                  </li>
                ) : num === currentPage ? (
                  <li key={num} aria-current="page">
                    <span className="inline-flex min-w-9 items-center justify-center rounded-lg border border-accent/50 px-2 py-1.5 text-sm font-semibold text-accent">
                      {num}
                    </span>
                  </li>
                ) : (
                  <li key={num}>
                    <Link href={buildHref(num)} className={linkClass}>
                      {num}
                    </Link>
                  </li>
                )
              )}
            </ol>

            {canGoNext ? (
              <Link
                href={buildHref(currentPage + 1)}
                aria-label={libraryStrings.next}
                className={linkClass}
              >
                {libraryStrings.next}
              </Link>
            ) : (
              <span aria-disabled="true" className={disabledLinkClass}>
                {libraryStrings.next}
              </span>
            )}

            <span className="text-sm text-muted">{pageOfLabel}</span>
          </nav>
        )}
      </section>
    </div>
  );
}