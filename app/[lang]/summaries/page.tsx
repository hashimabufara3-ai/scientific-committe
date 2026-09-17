import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "../dictionaries";
import { getSubjectsPage } from "../../../lib/content/data-access";
import SectionHeading from "../../../components/section-heading";
import Reveal from "../../../components/reveal";
import UnifiedLibrary from "../../../components/unified-library";

/* The public Resources page renders dynamically and reads the current active
   catalog (subjects + their summaries/exams) straight from PostgreSQL via the
   anonymous, cookie-free read client on every request.

   Freshness: this route is NOT statically generated or ISR-cached. It is fully
   dynamic (see `dynamic` below), so additions, edits and soft-deletes made by
   contributors are reflected for the next visitor immediately, on every Render
   instance, with no ISR cache to poison or revalidate and no per-instance
   stale-data window. The client Router Cache treats dynamic routes with
   staleTimes.dynamic = 0, so returning to this page always fetches fresh data.

   File bytes are never rendered here — cards carry metadata and fetch signed
   URLs on demand. */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/summaries">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return { title: dict.resourcesPage.title, description: dict.resourcesPage.subtitle };
}

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 50;

function normalizePage(value: string | undefined): number {
  if (value === undefined || value === "") return 1;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function normalizePageSize(value: string | undefined): number {
  if (value === undefined || value === "") return DEFAULT_PAGE_SIZE;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(n), MAX_PAGE_SIZE);
}

export default async function ResourcesPage(
  props: PageProps<"/[lang]/summaries">
) {
  /* In Next.js app router, `params` only carries route-segment values
     (e.g. { lang }); the search/page/pageSize values arrive via the
     `searchParams` prop (a Promise in Next.js 16). */
  const { lang } = await props.params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  const query = await props.searchParams;
  const readParam = (key: string): string | undefined => {
    const raw = query[key];
    if (raw === undefined || raw === null) return undefined;
    return typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  };

  const search = (readParam("search") ?? "").trim().slice(0, 100);
  const page = normalizePage(readParam("page"));
  const pageSize = normalizePageSize(readParam("pageSize"));

  /* Fetch exactly the requested page of visible subjects, with correct
     total/totalPages. Out-of-range pages are clamped to the last valid page. */
  const { subjects, page: effectivePage, pageSize: effectivePageSize, total, totalPages } =
    await getSubjectsPage({ page, pageSize, search });

  return (
    <main id="main-content" className="relative overflow-hidden pb-24">
      <UnifiedLibrary
        subjects={subjects}
        categories={dict.resourcesPage.categories}
        stageStrings={dict.resourcesPage.stage}
        libraryStrings={{
          empty: dict.resourcesPage.library.empty,
          emptyHint: dict.resourcesPage.library.emptyHint,
          emptyAction: dict.resourcesPage.library.emptyAction,
          counts: {
            summary: dict.contributePage.workspace.counts.summary,
            summaries: dict.contributePage.workspace.counts.summaries,
          },
          search: dict.resourcesPage.library.search,
          noResults: dict.resourcesPage.library.noResults,
          pagination: dict.resourcesPage.library.pagination,
          prev: dict.resourcesPage.library.prev,
          next: dict.resourcesPage.library.next,
          pageOf: dict.resourcesPage.library.pageOf,
        }}
        lang={lang}
        page={effectivePage}
        pageSize={effectivePageSize}
        total={total}
        totalPages={totalPages}
        search={search}
      >
        <Reveal>
          <div className="relative">
            <SectionHeading
              as="h1"
              kicker={dict.resourcesPage.library.kicker}
              title={dict.resourcesPage.title}
              subtitle={dict.resourcesPage.subtitle}
              align="center"
            />
          </div>
        </Reveal>
      </UnifiedLibrary>
    </main>
  );
}
