import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getDictionary, hasLocale } from "../dictionaries";
import { createClient } from "../../../lib/auth/supabase-server";
import SectionHeading from "../../../components/section-heading";
import { Panel } from "../../../components/contribute/primitives";
import { SignOutButton } from "../../../components/auth/sign-out-button";
import { UsernameField } from "../../../components/account/username-field";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/account">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return {
    title: dict.auth.account.title,
    description: dict.auth.account.subtitle,
  };
}

export default async function AccountPage({
  params,
}: PageProps<"/[lang]/account">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  // Server-side protection: redirect unauthenticated users away before any
  // account data is rendered.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/auth/sign-in?next=/${lang}/account`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, username, role, created_at")
    .eq("id", user.id)
    .maybeSingle();

  /* Committee member usernames are permanent — hide the edit control. */
  const { data: memberRow } = await supabase
    .from("committee_members")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  const isCommitteeMember = !!memberRow;

  const fullName =
    profile?.full_name || user.user_metadata?.full_name || "—";
  const username = profile?.username || "";
  const role = profile?.role
    ? dict.auth.account.roles[profile.role]
    : dict.auth.account.roles.student;

  const memberSince = new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(profile?.created_at ?? user.created_at));

  const rows: { label: string; value: string }[] = [
    { label: dict.auth.account.email, value: user.email ?? "—" },
    { label: dict.auth.account.fullName, value: fullName },
    { label: dict.auth.account.role, value: role },
    { label: dict.auth.account.memberSince, value: memberSince },
  ];

  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 sm:px-6"
    >
      <div className="pb-12 pt-20 sm:pt-28">
        <SectionHeading
          as="h1"
          kicker={dict.auth.account.kicker}
          title={dict.auth.account.title}
          subtitle={dict.auth.account.subtitle}
          align="center"
        />
      </div>

      <div className="mx-auto max-w-md">
        <Panel className="p-6 sm:p-8">
          <dl className="space-y-5 text-sm">
            {rows.map((row) => (
              <div key={row.label}>
                <dt className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-muted">
                  {row.label}
                </dt>
                <dd className="mt-1 text-foreground">{row.value}</dd>
              </div>
            ))}
          </dl>

          {!profile && (
            <p className="mt-5 text-xs text-muted">
              {dict.auth.account.noProfile}
            </p>
          )}

          {username && !isCommitteeMember && (
            <UsernameField
              lang={lang}
              username={username}
              t={dict.auth.account}
              errors={dict.auth.errors}
            />
          )}

          <div className="mt-8 border-t border-white/10 pt-6">
            <SignOutButton
              lang={lang}
              label={dict.auth.account.signOut}
              className="w-full"
            />
          </div>
        </Panel>
      </div>
    </main>
  );
}
