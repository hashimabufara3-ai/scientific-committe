"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GlobeIcon } from "./icons";

const LOCALE_PATTERN = /^\/(en|ar)(?=\/|$)/;

export function LangSwitcher({ lang }: { lang: string }) {
  const pathname = usePathname();
  const target = lang === "en" ? "ar" : "en";
  const rest = pathname.replace(LOCALE_PATTERN, "");
  const href = `/${target}${rest}`;
  const label = target === "ar" ? "العربية" : "English";

  return (
    <Link
      href={href}
      prefetch={false}
      className="inline-flex h-10 items-center gap-1.5 rounded-full border border-white/10 px-3 text-sm text-muted transition hover:border-accent/40 hover:text-foreground"
      aria-label={label}
    >
      <GlobeIcon className="h-4 w-4" />
      <span>{label}</span>
    </Link>
  );
}
