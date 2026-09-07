import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "../dictionaries";
import { requireRole } from "../../../lib/auth/authorize";
import {
  getMyContributions,
  getRecentContributorActivity,
  getSubjects,
} from "../../../lib/content/data-access";
import { createClient } from "../../../lib/auth/supabase-server";
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
  const { user, role } = await requireRole(lang, "contributor");

  // Active catalog rows (metadata only) straight from the database — the store
  // (localStorage prototype) is no longer read on the production path.
  const subjects = await getSubjects();

  // The persisted "Recent Activity" feed — latest contributor actions from
  // across the platform (others included). Public-safe fields only. Runs
  // through the session's SSR client so the RPC authorizes this user. The
  // feed intentionally shows OTHER contributors only: the viewer's own events
  // are excluded server-side by passing their user id.
  const supabase = await createClient();
  const activities = await getRecentContributorActivity(
    supabase,
    lang,
    8,
    user.id
  );

  // The signed-in contributor's OWN content only — server-scoped by author_id
  // (subjects/summaries/exam_files) through the session client, never a
  // client-side filter over other contributors' rows.
  const myContributions = await getMyContributions(supabase, user.id);

  return (
    <main id="main-content" className="relative overflow-hidden pb-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <ContributorDashboard
          lang={lang}
          t={dict.contributePage}
          currentUserId={user.id}
          currentRole={role}
          subjects={subjects}
          activities={activities}
          myContributions={myContributions}
        />
      </div>
    </main>
  );
}
