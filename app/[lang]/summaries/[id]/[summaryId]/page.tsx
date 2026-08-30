import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "../../../dictionaries";
import { getSubject, getSummary, getSummaryState } from "../../../../../lib/content/data-access";
import { displayName } from "../../../../../lib/content/mock-contributor-data";
import SummaryDetail from "../../../../../components/summary-detail";
import StatusFeedback from "../../../../../components/status-feedback";

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/summaries/[id]/[summaryId]">): Promise<Metadata> {
  const { lang, id, summaryId } = await params;
  if (!hasLocale(lang)) return {};
  const summary = await getSummary(id, summaryId);
  if (!summary) return {};
  return {
    title: displayName(summary.title, summary.titleAr, lang),
    description: displayName(
      summary.description ?? "",
      summary.descriptionAr,
      lang,
    ),
  };
}

export default async function SummaryDetailPage({
  params,
}: PageProps<"/[lang]/summaries/[id]/[summaryId]">) {
  const { lang, id, summaryId } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  const summaryState = await getSummaryState(id, summaryId);
  if (summaryState === "deleted") {
    const unavailable = dict.resourcesPage.detail.unavailable;
    return (
      <StatusFeedback
        kicker={unavailable.kicker}
        title={unavailable.title}
        body={unavailable.message}
        dir={lang === "ar" ? "rtl" : "ltr"}
        actions={[{ label: unavailable.back, href: `/${lang}/summaries` }]}
      />
    );
  }

  const subject = await getSubject(id);
  const summary = await getSummary(id, summaryId);
  if (!subject || !summary) notFound();

  const categoryLabel =
    dict.resourcesPage.categories.find((c) => c.id === subject.category)
      ?.label ??
    subject.category ??
    "general";

  const contributions = {
    kicker: dict.resourcesPage.detail.files,
    filesTitle: dict.resourcesPage.detail.files,
    filesSubtitle: dict.resourcesPage.detail.filesSubtitle,
    sourcesTitle: dict.resourcesPage.detail.externalResources,
    sourcesSubtitle: dict.resourcesPage.detail.externalResourcesSubtitle,
    addedBy: dict.contributePage.workspace.addedBy,
    you: dict.contributePage.you,
    download: dict.resourcesPage.detail.download,
    view: dict.resourcesPage.detail.view,
    watch: dict.resourcesPage.detail.watch,
    youtubeFallback: dict.resourcesPage.detail.youtubeFallback,
  };

  return (
    <SummaryDetail
      lang={lang}
      subject={subject}
      summary={summary}
      categoryLabel={categoryLabel}
      strings={{
        navResources: dict.nav.resources,
        backToSubject: dict.resourcesPage.detail.backToSubject,
        files: dict.resourcesPage.detail.files,
        filesSubtitle: dict.resourcesPage.detail.filesSubtitle,
        uploadedBy: dict.resourcesPage.detail.uploadedBy,
        pages: dict.resourcesPage.detail.pages,
        view: dict.resourcesPage.detail.view,
        externalResources: dict.resourcesPage.detail.externalResources,
        externalResourcesSubtitle:
          dict.resourcesPage.detail.externalResourcesSubtitle,
        watch: dict.resourcesPage.detail.watch,
        contributions,
      }}
    />
  );
}
