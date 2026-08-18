import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "../dictionaries";
import Reveal, { RevealGroup } from "../../../components/reveal";
import SectionHeading from "../../../components/section-heading";
import Card from "../../../components/card";
import { MapPinIcon } from "../../../components/icons";

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/contact">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return {
    title: dict.contactPage.title,
    description: dict.contactPage.subtitle,
  };
}

export default async function ContactPage({
  params,
}: PageProps<"/[lang]/contact">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  const details = [
    {
      icon: MapPinIcon,
      label: dict.contactPage.location,
      href: "https://maps.app.goo.gl/sLEeGx66hDf4xGVs8",
    },
  ];

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
      <div className="pb-12 pt-20 sm:pt-28">
        <Reveal>
          <SectionHeading
            as="h1"
            kicker={dict.contactPage.kicker}
            title={dict.contactPage.title}
            subtitle={dict.contactPage.subtitle}
            align="center"
          />
        </Reveal>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <RevealGroup step={0.12}>
        <Reveal className="h-full">
          <Card className="flex h-full flex-col p-8">
            <h2 className="text-lg font-semibold text-foreground">
              {dict.contactPage.location}
            </h2>
            <ul className="mt-6 space-y-4">
              {details.map((detail) => (
                <li key={detail.label} className="flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
                    <detail.icon className="h-4 w-4" />
                  </span>
                  <a
                    href={detail.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center rounded-xl border border-white/10 bg-white/[0.02] px-5 py-4 transition-colors hover:border-accent/40"
                  >
                    <span className="text-sm font-medium text-foreground">
                      {detail.label}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-4 ml-12 text-sm text-muted">
              {dict.contactPage.availability}
            </p>
          </Card>
        </Reveal>

        <Reveal className="h-full">
          <Card className="flex h-full flex-col p-8">
            <h2 className="text-lg font-semibold text-foreground">
              {dict.contactPage.socialsLabel}
            </h2>
            <ul className="mt-6 flex flex-1 flex-col gap-3">
              {dict.contactPage.socials.map((social) => (
                <li key={social.label} className="flex items-center gap-4">
                  <span className="shrink-0 text-sm font-medium text-foreground">
                    {social.label}
                  </span>
                  <a
                    href={social.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center rounded-xl border border-white/10 bg-white/[0.02] px-5 py-3 transition-colors hover:border-accent/40"
                  >
                    <span dir="ltr" className="text-xs text-muted transition-colors group-hover:text-accent">
                      {social.handle}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        </Reveal>
        </RevealGroup>
      </div>
    </main>
  );
}
