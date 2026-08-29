"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LangSwitcher } from "./lang-switcher";
import { Logo } from "./logo";
import { CloseIcon, MenuIcon } from "./icons";
import { useUser, useRole } from "./auth/use-auth";
import { SignOutButton } from "./auth/sign-out-button";

export type NavDict = {
  home: string;
  resources: string;
  contribute: string;
  admin: string;
  about: string;
  contact: string;
  cta: string;
  signIn: string;
  signOut: string;
  account: string;
  siteName: string;
  campus: string;
};

export default function Nav({ dict, lang }: { dict: NavDict; lang: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { user } = useUser();
  const { role } = useRole();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  /* Visibility is UX only — the routes themselves are protected server-side.
     Contributor+ sees Contribute; admin/owner additionally see Admin. */
  const isContributor =
    !!user && role !== null && ["contributor", "admin", "owner"].includes(role);
  const isAdminOrOwner =
    !!user && role !== null && ["admin", "owner"].includes(role);

  const links = [
    { href: `/${lang}`, label: dict.home, exact: true },
    { href: `/${lang}/summaries`, label: dict.resources },
    ...(isContributor
      ? [{ href: `/${lang}/contribute`, label: dict.contribute }]
      : []),
    ...(isAdminOrOwner
      ? [{ href: `/${lang}/admin`, label: dict.admin }]
      : []),
    { href: `/${lang}/about`, label: dict.about },
    { href: `/${lang}/contact`, label: dict.contact },
  ];

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const linkClass = (href: string, exact?: boolean) =>
    `rounded-full px-3.5 py-2 text-sm transition-colors ${
      isActive(href, exact)
        ? "bg-accent/10 text-accent"
        : "text-muted hover:text-foreground"
    }`;

  return (
    <header
      className="sticky top-0 z-50 border-b border-white/10 bg-ink/75 backdrop-blur-md"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo
          href={`/${lang}`}
          name={dict.siteName.split(" ").slice(0, 2).join(" ")}
          subtitle={lang === "ar" ? dict.siteName.split(" ").slice(2).join(" ") : dict.campus}
        />

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={linkClass(link.href, link.exact)}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <LangSwitcher lang={lang} />
          {user ? (
            <>
              <Link
                href={`/${lang}/account`}
                className="btn-ghost hidden !px-4 !py-2 sm:inline-flex"
              >
                {dict.account}
              </Link>
              <SignOutButton
                lang={lang}
                label={dict.signOut}
                className="hidden sm:inline-flex"
              />
            </>
          ) : (
            <>
              <Link
                href={`/${lang}/auth/sign-in`}
                className="btn-ghost hidden !px-4 !py-2 sm:inline-flex"
              >
                {dict.signIn}
              </Link>
              <Link
                href={`/${lang}/contact`}
                className="btn-primary hidden !px-4 !py-2 sm:inline-flex"
              >
                {dict.cta}
              </Link>
            </>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-foreground transition hover:border-accent/40 lg:hidden"
          >
            {open ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div
          id="mobile-nav"
          className="border-t border-white/10 bg-surface lg:hidden"
        >
          <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4 sm:px-6" aria-label="Mobile">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={`rounded-xl px-4 py-3 text-sm transition-colors ${
                  isActive(link.href, link.exact)
                    ? "bg-accent/10 text-accent"
                    : "text-muted hover:bg-white/5 hover:text-foreground"
                }`}
              >
                {link.label}
              </Link>
            ))}
            {user ? (
              <>
                <Link
                  href={`/${lang}/account`}
                  onClick={() => setOpen(false)}
                  className="rounded-xl px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-white/5"
                >
                  {dict.account}
                </Link>
                <SignOutButton
                  lang={lang}
                  label={dict.signOut}
                  className="mt-2 w-full"
                />
              </>
            ) : (
              <>
                <Link
                  href={`/${lang}/auth/sign-in`}
                  onClick={() => setOpen(false)}
                  className="rounded-xl px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-white/5"
                >
                  {dict.signIn}
                </Link>
                <Link
                  href={`/${lang}/contact`}
                  onClick={() => setOpen(false)}
                  className="btn-primary mt-2"
                >
                  {dict.cta}
                </Link>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
