import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "../../dictionaries";
import { AuthShell } from "../../../../components/auth/auth-shell";
import { ForgotPasswordForm } from "../../../../components/auth/forgot-password-form";

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/auth/forgot-password">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return {
    title: dict.auth.forgot.title,
    description: dict.auth.forgot.subtitle,
  };
}

export default async function ForgotPasswordPage({
  params,
}: PageProps<"/[lang]/auth/forgot-password">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <AuthShell
      kicker={dict.auth.kicker}
      title={dict.auth.forgot.title}
      subtitle={dict.auth.forgot.subtitle}
    >
      <ForgotPasswordForm lang={lang} dict={dict.auth} />
    </AuthShell>
  );
}
