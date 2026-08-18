import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, hasLocale } from "../dictionaries";
import { createClient } from "../../../lib/auth/supabase-server";
import Reveal from "../../../components/reveal";
import SectionHeading from "../../../components/section-heading";
import AboutIntro from "../../../components/about-intro";
import AboutMembers from "../../../components/about-members";
import AboutStory from "../../../components/about-story";
import AboutPanel from "../../../components/about-panel";
import { SparkIcon } from "../../../components/icons";

const activityDepths = [0, 12, 24, 8];

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/about">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return { title: dict.about.title, description: dict.about.subtitle };
}

export default async function AboutPage({ params }: PageProps<"/[lang]/about">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();

  const [dict, supabase] = await Promise.all([
    getDictionary(lang),
    createClient(),
  ]);
  const { data: rawMembers } = await supabase
    .from("committee_members")
    .select(
      "name_ar, name_en, major_ar, major_en, role_ar, role_en, gender, sort_order"
    )
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  /* Active-only is enforced by RLS and the is_active filter in the query;
     the JS sort mirrors the query order (defense-in-depth). Map to the shape
     the carousel expects, selecting the correct language. Fallback to empty
     array on error. */
  const members = (rawMembers ?? [])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((m) => ({
      name: lang === "ar" ? m.name_ar : m.name_en,
      role: lang === "ar" ? m.role_ar : m.role_en,
      major: lang === "ar" ? m.major_ar : m.major_en,
      gender: m.gender,
    }));

  return (
    <main id="main-content" className="overflow-x-clip">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* SCENE 1 — introduction */}
        <AboutIntro
          kicker={dict.about.kicker}
          title={dict.about.title}
        />

        {/* SCENE 2 — story discovery */}
        <AboutStory line={dict.about.subtitle} />

        {/* SCENE 3 — mission */}
        <div className="mt-14">
          <AboutPanel
            variant="chapter"
            enterDepth={34}
            className="h-full"
            cardClassName="h-full p-8"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
              <SparkIcon className="h-5 w-5" />
            </span>
            <h2 className="mt-5 text-xl font-semibold text-foreground">
              {dict.about.missionTitle}
            </h2>
            <p className="mt-3 text-base leading-relaxed text-muted">
              {dict.about.mission}
            </p>
          </AboutPanel>
        </div>

        {/* Members */}
        <section className="mt-20">
          <Reveal>
            <SectionHeading
              id="members-heading"
              kicker={dict.about.membersKicker}
              title={dict.about.membersTitle}
              subtitle={dict.about.membersSubtitle}
            />
          </Reveal>
          {members.length > 0 ? (
            <AboutMembers
              members={members}
              labelledBy="members-heading"
              prevLabel={dict.about.membersPrev}
              nextLabel={dict.about.membersNext}
            />
          ) : (
            <p className="mt-8 text-center text-sm text-muted">
              {lang === "ar"
                ? "لا يوجد أعضاء حالياً."
                : "No committee members to display yet."}
            </p>
          )}
        </section>

        {/* SCENE 4 — activities */}
        <section className="mt-20">
          <Reveal>
            <SectionHeading
              kicker={dict.about.activitiesKicker}
              title={dict.about.activitiesTitle}
            />
          </Reveal>
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {dict.about.activities.map((activity, index) => (
              <AboutPanel
                key={activity.title}
                depth={activityDepths[index % activityDepths.length]}
                delay={(index % 2) * 0.12}
                className="h-full"
                cardClassName="h-full p-6"
              >
                <h3 className="text-lg font-semibold text-foreground">
                  {activity.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {activity.description}
                </p>
              </AboutPanel>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
