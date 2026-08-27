"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

export default function Error({ reset }: ErrorPageProps) {
  const pathname = usePathname() ?? "";
  const match = pathname.match(LOCALE_PATTERN);
  const lang = match ? match[1] : "en";
  const isAr = lang === "ar";
  const c = COPY[isAr ? "ar" : "en"];

  return (
    <main
      id="main-content"
      dir={isAr ? "rtl" : "ltr"}
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-4 py-28 text-center sm:px-6"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
        {isAr ? "خطأ" : "Error"}
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
        {isAr ? c.titleAr : c.titleEn}
      </h1>
      <p className="mt-6 max-w-md text-base leading-relaxed text-muted" role="status">
        {isAr ? c.bodyAr : c.bodyEn}
      </p>
      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={reset} className="btn-primary">
          {isAr ? c.retryAr : c.retryEn}
        </button>
        <Link href={`/${lang}`} className="btn-ghost">
          {isAr ? c.homeAr : c.homeEn}
        </Link>
      </div>
    </main>
  );
}
