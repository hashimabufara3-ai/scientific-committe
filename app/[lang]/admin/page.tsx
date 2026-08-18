import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "../dictionaries";
import { requireRole } from "../../../lib/auth/authorize";
import type { Role } from "../../../lib/auth/roles";
import { createClient } from "../../../lib/auth/supabase-server";
import SectionHeading from "../../../components/section-heading";
import AdminDashboard from "../../../components/admin/admin-dashboard";
import CommitteeMembersSection from "../../../components/admin/committee-members";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/admin">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return {
    title: dict.adminPage.title,
    description: dict.adminPage.subtitle,
  };
}

export default async function AdminPage({
  params,
}: PageProps<"/[lang]/admin">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  // Server-side protection: admin and owner only. Redirects unauthenticated
  // users and anyone below admin before any member data is rendered.
  const { user, role } = await requireRole(lang, "admin");

  const supabase = await createClient();
  // Member data comes only from the admin_list_members() RPC, which returns
  // id/full_name/username/role/created_at and never email. There is no direct
  // profiles SELECT here (the broad admin-read policy has been removed).
  const { data: members, error: membersError } = await supabase.rpc(
    "admin_list_members"
  );
  // Never swallow the RPC error: a failed listing used to render as "0
  // members" with no diagnostics. Log it and show an explicit error state.
  if (membersError) {
    console.error("[admin] admin_list_members() failed:", membersError);
  }

  // Committee members for the About page carousel
  const { data: committeeMembers, error: cmError } = await supabase.rpc(
    "admin_list_committee_members"
  );
  if (cmError) {
    console.error("[admin] admin_list_committee_members() failed:", cmError);
  }

  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 sm:px-6"
    >
      <div className="pb-12 pt-20 sm:pt-28">
        <SectionHeading
          as="h1"
          kicker={dict.adminPage.kicker}
          title={dict.adminPage.title}
          subtitle={dict.adminPage.subtitle}
          align="center"
        />
      </div>

      <div className="mx-auto max-w-3xl space-y-16">
        <CommitteeMembersSection
          lang={lang}
          t={dict.adminPage.committeeMembers}
          members={(committeeMembers ?? []).map((cm) => ({
            id: cm.id,
            user_id: cm.user_id,
            name_ar: cm.name_ar,
            name_en: cm.name_en,
            major_ar: cm.major_ar,
            major_en: cm.major_en,
            role_ar: cm.role_ar,
            role_en: cm.role_en,
            gender: cm.gender as "male" | "female",
            sort_order: cm.sort_order,
            is_active: cm.is_active,
            created_at: cm.created_at,
            updated_at: cm.updated_at,
          }))}
          users={(members ?? []).map((m) => ({
            id: m.id,
            full_name: m.full_name,
            username: m.username,
          }))}
          loadFailed={cmError !== null}
        />

        <AdminDashboard
          lang={lang}
          t={dict.adminPage}
          roleLabels={dict.auth.account.roles}
          currentUserId={user.id}
          currentRole={role}
          loadFailed={membersError !== null}
          members={(members ?? []).map((member) => ({
            id: member.id,
            full_name: member.full_name,
            username: member.username,
            role: member.role as Role,
            created_at: member.created_at,
          }))}
        />
      </div>
    </main>
  );
}
