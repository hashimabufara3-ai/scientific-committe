import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "../../dictionaries";
import { AuthShell } from "../../../../components/auth/auth-shell";
import { SignUpForm } from "../../../../components/auth/sign-up-form";

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/auth/sign-up">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return {
    title: dict.auth.signUp.title,
    description: dict.auth.signUp.subtitle,
  };
}

export default async function SignUpPage({
  params,
}: PageProps<"/[lang]/auth/sign-up">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <AuthShell
      kicker={dict.auth.kicker}
      title={dict.auth.signUp.title}
      subtitle={dict.auth.signUp.subtitle}
    >
      <SignUpForm lang={lang} dict={dict.auth} />
    </AuthShell>
  );
}
