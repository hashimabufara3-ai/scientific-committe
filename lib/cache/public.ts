import { revalidateTag } from "next/cache";

/* Cache tags for PUBLIC, non-sensitive, display-only data.
   Only the homepage Hero committee-member count is cached (see
   lib/content/hero-stats.ts). Never add rows, files, or auth-sensitive data
   to this module — anything tagged here is served from the in-memory cache. */
export const tags = {
  heroStats: "public:hero-stats",
} as const;

/* Invalidate the cached homepage Hero count. Called only AFTER a committee
   member mutation succeeds. Uses the recommended 'max' profile
   (stale-while-revalidate) so the next visitor gets a fresh count. */
export function revalidateHeroStats() {
  revalidateTag(tags.heroStats, "max");
}
