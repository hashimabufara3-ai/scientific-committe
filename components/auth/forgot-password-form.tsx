import Link from "next/link";
import type { DictionaryData } from "../../app/[lang]/dictionaries";
import { LockIcon, ExternalLinkIcon } from "../icons";

/* Official Scientific Committee Instagram account (password recovery is
   handled in person / via the committee, never by an automatic email flow). */
const INSTAGRAM_URL = "https://www.instagram.com/scientific.committee/";

/* "Forgot your password?" contact screen.

   Replaces the previous password-reset form. There is no email, no recovery
   email, and no Supabase reset link: the user is directed to contact the
   Scientific Committee, exactly as the product decided. The page is fully
   static — no server action, no client state, nothing is sent. */
export function ForgotPasswordForm({
  lang,
  dict,
}: {
  lang: string;
  dict: DictionaryData["auth"];
}) {
  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <span className="grid h-14 w-14 place-items-center rounded-full border border-accent/30 bg-accent/10 text-accent">
          <LockIcon className="h-6 w-6" />
        </span>
      </div>

      <a
        href={INSTAGRAM_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-primary inline-flex w-full items-center justify-center gap-2"
      >
        {dict.forgot.contact}
        <ExternalLinkIcon className="h-4 w-4" />
      </a>

      <div className="text-center">
        <Link
          href={`/${lang}/auth/sign-in`}
          className="text-sm font-medium text-muted transition-colors hover:text-foreground"
        >
          {dict.forgot.backToSignIn}
        </Link>
      </div>
    </div>
  );
}