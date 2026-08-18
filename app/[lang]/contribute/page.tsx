import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "../dictionaries";
import { requireRole } from "../../../lib/auth/authorize";
import ContributorDashboard from "../../../components/contribute/contributor-dashboard";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/contribute">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return { title: dict.contributePage.title, description: dict.contributePage.subtitle };
}

export default async function ContributePage({
  params,
}: PageProps<"/[lang]/contribute">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  // Server-side gate: only contributor, admin and owner may enter the
  // workspace. Students are redirected; navigation alone is never trusted.
  await requireRole(lang, "contributor");

  return (
    <main id="main-content" className="relative overflow-hidden pb-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <ContributorDashboard lang={lang} t={dict.contributePage} />
      </div>
    </main>
  );
}
