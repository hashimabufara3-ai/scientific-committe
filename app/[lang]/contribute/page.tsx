import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "../dictionaries";
import { requireRole } from "../../../lib/auth/authorize";
import { getSubjects } from "../../../lib/content/data-access";
import ContributorDashboard from "../../../components/contribute/contributor-dashboard";

/* The contribute workspace is always resolved fresh from the database: the
   page is dynamic so every mutation round-trip (via the server actions + a
   client router.refresh()) re-renders with current rows. */

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
  const { user } = await requireRole(lang, "contributor");

  // Active catalog rows (metadata only) straight from the database — the store
  // (localStorage prototype) is no longer read on the production path.
  const subjects = await getSubjects();

  return (
    <main id="main-content" className="relative overflow-hidden pb-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <ContributorDashboard
          lang={lang}
          t={dict.contributePage}
          currentUserId={user.id}
          subjects={subjects}
        />
      </div>
    </main>
  );
}
