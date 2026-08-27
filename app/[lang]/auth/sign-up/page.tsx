import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { hasLocale } from "../../dictionaries";

/* Public self-registration has been disabled. Accounts are created
   exclusively by administrators. Redirect any visitor to /auth/sign-up to the
   sign-in page instead of rendering a registration form. */
export default async function SignUpPage({
  params,
}: PageProps<"/[lang]/auth/sign-up">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  redirect(`/${lang}/auth/sign-in`);
}
