import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "../../dictionaries";
import { AuthShell } from "../../../../components/auth/auth-shell";
import { SignInForm } from "../../../../components/auth/sign-in-form";

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/auth/sign-in">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return {
    title: dict.auth.signIn.title,
    description: dict.auth.signIn.subtitle,
  };
}

export default async function SignInPage({
  params,
  searchParams,
}: PageProps<"/[lang]/auth/sign-in">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  const resetSuccess = sp.reset === "success";
  const linkError =
    sp.error === "invalid-link" ? dict.auth.errors.invalidToken : undefined;

  return (
    <AuthShell
      kicker={dict.auth.kicker}
      title={dict.auth.signIn.title}
      subtitle={dict.auth.signIn.subtitle}
    >
      <SignInForm
        lang={lang}
        dict={dict.auth}
        next={next}
        linkError={linkError}
        resetSuccess={resetSuccess}
      />
    </AuthShell>
  );
}
