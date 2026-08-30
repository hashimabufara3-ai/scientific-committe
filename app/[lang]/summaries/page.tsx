import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "../dictionaries";
import { getSubjects } from "../../../lib/content/data-access";
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

export default async function ResourcesPage({
  params,
}: PageProps<"/[lang]/summaries">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const subjects = await getSubjects();

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
        }}
        lang={lang}
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
