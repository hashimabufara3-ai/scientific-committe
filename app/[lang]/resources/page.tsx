import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "../dictionaries";
import SectionHeading from "../../../components/section-heading";
import Reveal from "../../../components/reveal";
import UnifiedLibrary from "../../../components/unified-library";

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/resources">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return { title: dict.resourcesPage.title, description: dict.resourcesPage.subtitle };
}

export default async function ResourcesPage({
  params,
}: PageProps<"/[lang]/resources">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <main id="main-content" className="relative overflow-hidden pb-24">
      <UnifiedLibrary
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
          <SectionHeading
            as="h1"
            kicker={dict.resourcesPage.library.kicker}
            title={dict.resourcesPage.title}
            subtitle={dict.resourcesPage.subtitle}
            align="center"
          />
        </Reveal>
      </UnifiedLibrary>
    </main>
  );
}
