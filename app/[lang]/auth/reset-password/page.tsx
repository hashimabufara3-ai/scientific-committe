import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getDictionary, hasLocale } from "../../dictionaries";
import { createClient } from "../../../../lib/auth/supabase-server";
import { AuthShell } from "../../../../components/auth/auth-shell";
import { ResetPasswordForm } from "../../../../components/auth/reset-password-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/auth/reset-password">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return {
    title: dict.auth.reset.title,
    description: dict.auth.reset.subtitle,
  };
}

export default async function ResetPasswordPage({
  params,
}: PageProps<"/[lang]/auth/reset-password">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  // Requires an active recovery session, established by the auth callback.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/auth/forgot-password`);

  return (
    <AuthShell
      kicker={dict.auth.kicker}
      title={dict.auth.reset.title}
      subtitle={dict.auth.reset.subtitle}
    >
      <ResetPasswordForm lang={lang} dict={dict.auth} />
    </AuthShell>
  );
}
