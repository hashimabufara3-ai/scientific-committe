import Link from "next/link";
import { Logo } from "./logo";
import { MapPinIcon } from "./icons";

export type FooterDict = {
  tagline: string;
  quickLinks: string;
  contact: string;
  follow: string;
  location: string;
  rights: string;
  madeBy: string;
  siteName: string;
  campus: string;
  links: { href: string; label: string }[];
  socials: { label: string; url: string }[];
};

export function Footer({ dict, lang }: { dict: FooterDict; lang: string }) {
  return (
    <footer className="border-t border-white/10 bg-surface/60">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Logo
              href={`/${lang}`}
              name={lang === "ar" ? dict.siteName.split(" ").slice(0, 2).join(" ") : dict.siteName}
              subtitle={lang === "ar" ? dict.siteName.split(" ").slice(2).join(" ") : dict.campus}
            />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">
              {dict.tagline}
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold text-foreground">{dict.quickLinks}</p>
            <ul className="mt-4 space-y-2.5">
              {dict.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-block py-2.5 text-sm text-muted transition-colors hover:text-accent"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-sm font-semibold text-foreground">{dict.contact}</p>
            <ul className="mt-4 space-y-2.5 text-sm text-muted">
              <li className="flex items-center gap-2.5">
                <MapPinIcon className="h-4 w-4 shrink-0 text-accent" />
                <a
                  href="https://maps.app.goo.gl/sLEeGx66hDf4xGVs8"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block py-2.5 transition-colors hover:text-accent"
                >
                  {dict.location}
                </a>
              </li>
            </ul>
            {dict.socials.length > 0 && (
              <div className="mt-5">
                <p className="text-sm font-semibold text-foreground">{dict.follow}</p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {dict.socials.map((social) => (
                    <li key={social.label}>
                      <a
                        href={social.url}
                        className="inline-flex rounded-full border border-white/10 px-3 py-2.5 text-xs text-muted transition hover:border-accent/40 hover:text-accent"
                      >
                        {social.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-2 border-t border-white/10 pt-6 text-xs text-muted sm:flex-row">
          <p>{dict.rights}</p>
          <p>{dict.madeBy}</p>
        </div>
      </div>
    </footer>
  );
}
