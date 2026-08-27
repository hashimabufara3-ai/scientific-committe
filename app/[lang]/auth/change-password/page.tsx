import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "../../dictionaries";
import { AuthShell } from "../../../../components/auth/auth-shell";
import { ChangePasswordForm } from "../../../../components/auth/change-password-form";

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/auth/change-password">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return {
    title: dict.auth.changePassword.title,
    description: dict.auth.changePassword.subtitle,
  };
}

export default async function ChangePasswordPage({
  params,
}: PageProps<"/[lang]/auth/change-password">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <AuthShell
      kicker={dict.auth.kicker}
      title={dict.auth.changePassword.title}
      subtitle={dict.auth.changePassword.subtitle}
    >
      <ChangePasswordForm lang={lang} dict={dict.auth} />
    </AuthShell>
  );
}
