import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "../../dictionaries";
import { getSubject, getSubjectState } from "../../../../lib/content/data-access";
import { displayName } from "../../../../lib/content/mock-contributor-data";
import MaterialDetail from "../../../../components/material-detail";
import StatusFeedback from "../../../../components/status-feedback";

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/summaries/[id]">): Promise<Metadata> {
  const { lang, id } = await params;
  if (!hasLocale(lang)) return {};
  const subject = await getSubject(id);
  if (!subject) return {};
  return { title: displayName(subject.title, subject.titleAr, lang) };
}

export default async function ResourceDetailPage({
  params,
}: PageProps<"/[lang]/summaries/[id]">) {
  const { lang, id } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  const subjectState = await getSubjectState(id);
  if (subjectState === "deleted") {
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
  if (!subject) notFound();

  return (
    <MaterialDetail
      lang={lang}
      subject={subject}
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
