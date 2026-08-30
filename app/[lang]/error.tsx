"use client";

import { usePathname } from "next/navigation";
import { captureBoundaryError } from "../../lib/security/sentry";
import StatusFeedback from "../../components/status-feedback";

/* Localized error boundary for the [lang] route tree (Next.js App Router).

   This is a Client Component because error boundaries must be client-side.
   It deliberately renders a safe, generic message only — never error.message,
   error.stack, or any internal/Supabase/database detail. The locale is derived
   from the pathname (error.tsx has no params), reusing the same pattern used
   by the lang switcher. Text is kept inline and bilingual, mirroring
   not-found.tsx, so no async dictionary lookup or architecture change is
   required for an error-only screen.

   Accessibility: semantic <h1>, labelled actions, visible keyboard focus,
   screen-reader-friendly live region, and no animation (safe under
   prefers-reduced-motion). */

const LOCALE_PATTERN = /^\/(en|ar)(?=\/|$)/;

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

const COPY: Record<
  string,
  {
    titleEn: string;
    bodyEn: string;
    retryEn: string;
    homeEn: string;
    titleAr: string;
    bodyAr: string;
    retryAr: string;
    homeAr: string;
  }
> = {
  en: {
    titleEn: "Something went wrong",
    bodyEn: "An unexpected error occurred. Please try again, or return to the home page.",
    retryEn: "Try again",
    homeEn: "Back to home",
    titleAr: "حدث خطأ ما",
    bodyAr: "حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى، أو العودة إلى الصفحة الرئيسية.",
    retryAr: "إعادة المحاولة",
    homeAr: "العودة إلى الرئيسية",
  },
  ar: {
    titleEn: "Something went wrong",
    bodyEn: "An unexpected error occurred. Please try again, or return to the home page.",
    retryEn: "Try again",
    homeEn: "Back to home",
    titleAr: "حدث خطأ ما",
    bodyAr: "حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى، أو العودة إلى الصفحة الرئيسية.",
    retryAr: "إعادة المحاولة",
    homeAr: "العودة إلى الرئيسية",
  },
};

export default function Error({ error, reset }: ErrorPageProps) {
  const pathname = usePathname() ?? "";
  const match = pathname.match(LOCALE_PATTERN);
  const lang = match ? match[1] : "en";
  const isAr = lang === "ar";
  const c = COPY[isAr ? "ar" : "en"];

  /* P1-1A: Safe, fail-open internal error capture. This does NOT alter the
     visible error page, its accessibility/RTL handling, locale derivation, or
     the reset flow. Only a sanitized message and a path label are sent; all
     sensitive data is stripped by redactEvent before transmission. */
  try {
    captureBoundaryError(error, {
      component: "lang-error",
      route: pathname || undefined,
      digest: error.digest,
    });
  } catch {
    /* Tracking must never break the error boundary. */
  }

  return (
    <StatusFeedback
      kicker={isAr ? "خطأ" : "Error"}
      title={isAr ? c.titleAr : c.titleEn}
      body={isAr ? c.bodyAr : c.bodyEn}
      dir={isAr ? "rtl" : "ltr"}
      actions={[
        { label: isAr ? c.retryAr : c.retryEn, onClick: reset, variant: "primary" },
        { label: isAr ? c.homeAr : c.homeEn, href: `/${lang}`, variant: "ghost" },
      ]}
    />
  );
}
