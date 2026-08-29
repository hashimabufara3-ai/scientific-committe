import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "../dictionaries";
import { getSubjects } from "../../../lib/content/data-access";
import SectionHeading from "../../../components/section-heading";
import Reveal from "../../../components/reveal";
import UnifiedLibrary from "../../../components/unified-library";
import AddSummaryButton from "../../../components/add-summary-button";

/* Time-based ISR: regenerate this SSG page at most every 60s so newly created
   subjects appear without a rebuild (see comment on ResourcesPage below). */
export const revalidate = 60;

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/summaries">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return { title: dict.resourcesPage.title, description: dict.resourcesPage.subtitle };
}

/* The public Resources page pulls its catalog from PostgreSQL (active subjects
   + their summaries/exams) via the anonymous, cookie-free read client.

   Freshness: this route is statically generated at build time (the [lang]
   layout uses generateStaticParams + dynamicParams=false), and in Next 16
   on-demand revalidatePath() does not reliably regenerate build-time pages
   (it can throw NoFallbackError and 404 instead of re-rendering). We therefore
   use time-based ISR (revalidate below) so a contributor-created subject
   appears shortly after creation without a rebuild. The server actions still
   call revalidatePath() as an extra best-effort invalidation.

   File bytes are never rendered here — cards carry metadata and fetch signed
   URLs on demand. */
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
            <div className="mt-6 flex justify-center lg:absolute lg:end-0 lg:top-0 lg:mt-0">
              <AddSummaryButton
                lang={lang}
                label={dict.resourcesPage.addSummary}
              />
            </div>
          </div>
        </Reveal>
      </UnifiedLibrary>
    </main>
  );
}
