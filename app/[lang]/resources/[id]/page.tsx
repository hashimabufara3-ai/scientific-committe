import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "../../dictionaries";
import MaterialDetail from "../../../../components/material-detail";
import {
  displayName,
  seedContributorData,
} from "../../../../lib/content/mock-contributor-data";

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/resources/[id]">): Promise<Metadata> {
  const { lang, id } = await params;
  if (!hasLocale(lang)) return {};
  const subject = seedContributorData().subjects.find((s) => s.id === id);
  if (!subject) return {};
  return { title: displayName(subject.title, subject.titleAr, lang) };
}

export default async function ResourceDetailPage({
  params,
}: PageProps<"/[lang]/resources/[id]">) {
  const { lang, id } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <MaterialDetail
      lang={lang}
      urlId={id}
      categories={dict.resourcesPage.categories}
      strings={{
        navResources: dict.nav.resources,
        back: dict.resourcesPage.detail.back,
        files: dict.resourcesPage.detail.files,
        filesSubtitle: dict.resourcesPage.detail.filesSubtitle,
        readFile: dict.resourcesPage.detail.readFile,
        exams: {
          ...dict.previousExams,
          download: dict.resourcesPage.detail.download,
          view: dict.resourcesPage.detail.view,
        },
      }}
    />
  );
}
