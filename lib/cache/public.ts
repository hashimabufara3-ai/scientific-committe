import { updateTag } from "next/cache";

/* Cache tags for PUBLIC, non-sensitive, display-only data.
   Only the homepage Hero committee-member count is cached (see
   lib/content/hero-stats.ts). Never add rows, files, or auth-sensitive data
   to this module — anything tagged here is served from the in-memory cache. */
export const tags = {
  heroStats: "public:hero-stats",
} as const;

/* Invalidate the cached homepage Hero count. Called only AFTER a committee
   member mutation succeeds.

   We use updateTag (read-your-own-writes) rather than revalidateTag(tag, 'max')
   because the admin who just mutated must see the new count on the very next
   homepage render. revalidateTag with the 'max' profile uses
   stale-while-revalidate, which serves the OLD cached count on the next visit
   while refreshing in the background — that allowed the homepage to stay stale
   after a mutation. updateTag immediately expires the tagged entry, so the
   next request recomputes the count synchronously (no stale value served), and
   it also invalidates the client-side Router Cache for the affected route. */
export function revalidateHeroStats() {
  updateTag(tags.heroStats);
}
