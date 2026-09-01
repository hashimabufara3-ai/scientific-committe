import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "./dictionaries";
import { getActiveCommitteeMemberCount } from "../../lib/content/hero-stats";
import HeroCinematic from "../../components/hero-cinematic";
import Reveal from "../../components/reveal";
import SectionHeading from "../../components/section-heading";
import Card from "../../components/card";
import CinematicSection from "../../components/cinematic-section";
import {
  ArrowRightIcon,
  BookIcon,
  SparkIcon,
  UsersIcon,
} from "../../components/icons";

const PILLAR_ICONS = {
  book: BookIcon,
  community: UsersIcon,
} as const;

export async function generateMetadata({
  params,
}: PageProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return { title: dict.hero.titleA, description: dict.hero.subtitle };
}

/* Real, server-fetched hero statistic. Only values backed by a trustworthy
   real data source are shown — never a fabricated number.
     * Committee members: count of active members via a lightweight count query
   on the public committee_members table. RLS allows anon read access.
   `head: true` tells Supabase to return only the count — no rows are
   transferred, making this significantly faster than the RPC that fetched
   every member row just to count them.

   The count itself comes from getActiveCommitteeMemberCount(), which is a
   cached function (unstable_cache, cookie-free anon read) so it can be
   cached safely. Only that aggregate is cached — never member rows. */
async function getHeroStats(committeeLabel: string) {
  const stats: { value: string; label: string }[] = [];

  const count = await getActiveCommitteeMemberCount();
  if (count > 0) {
    stats.push({ value: `+${count}`, label: committeeLabel });
  }

  return stats;
}

export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();

  const dict = await getDictionary(lang);
  const stats = await getHeroStats(dict.stats.committeeMembers);

  return (
    <main id="main-content">
      <HeroCinematic hero={dict.hero} stats={stats} lang={lang} />

      <div className="trace mx-auto max-w-6xl px-4 sm:px-6" aria-hidden="true" />

      {/* Pillars */}
      <CinematicSection>
        <section id="pillars" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 sm:py-24">
          <Reveal>
            <SectionHeading
              kicker={dict.pillars.kicker}
              title={dict.pillars.title}
              subtitle={dict.pillars.subtitle}
            />
          </Reveal>
          <div className="mt-12 grid gap-5 sm:grid-cols-2">
            {dict.pillars.items.map((pillar, index) => {
              const Icon = PILLAR_ICONS[pillar.icon as keyof typeof PILLAR_ICONS];
              return (
                <Reveal key={pillar.title} delay={index * 0.08} className="h-full">
                  <Card className="h-full p-6">
                    <span className="grid h-11 w-11 place-items-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className="mt-5 text-lg font-semibold text-foreground">
                      {pillar.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                      {pillar.description}
                    </p>
                  </Card>
                </Reveal>
              );
            })}
          </div>
        </section>
      </CinematicSection>

      {/* Community */}
      <CinematicSection variant="soft">
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <Reveal>
            <SectionHeading
              kicker={dict.community.kicker}
              title={dict.community.title}
              subtitle={dict.community.subtitle}
              align="center"
            />
          </Reveal>
          <Reveal delay={0.1}>
            <ul className="mx-auto mt-10 flex max-w-3xl flex-wrap justify-center gap-2.5">
              {dict.community.topics.map((topic) => (
                <li key={topic}>
                  <span className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-muted">
                    {topic}
                  </span>
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={0.16} className="mt-10 flex flex-col items-center gap-3">
            <Link href={`/${lang}/contact`} className="btn-primary">
              <UsersIcon className="h-4 w-4" />
              {dict.community.cta}
            </Link>
            <p className="text-xs text-muted">{dict.community.note}</p>
          </Reveal>
        </section>
      </CinematicSection>

      {/* Join banner */}
      <CinematicSection variant="calm">
        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-accent/20 via-surface to-surface p-8 text-center sm:p-14">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -end-20 -top-20 h-64 w-64 rounded-full bg-accent/20 blur-[100px]"
              />
              <div className="relative">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-accent/30 bg-accent/10 text-accent">
                  <SparkIcon className="h-6 w-6" />
                </span>
                <h2 className="mx-auto mt-6 max-w-xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  {dict.join.title}
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted">
                  {dict.join.description}
                </p>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                  <Link href={`/${lang}/contact`} className="btn-primary">
                    {dict.join.cta}
                    <ArrowRightIcon className="h-4 w-4 rtl-flip" />
                  </Link>
                </div>
              </div>
            </div>
          </Reveal>
        </section>
      </CinematicSection>
    </main>
  );
}
