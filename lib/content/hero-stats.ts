import { unstable_cache } from "next/cache";
import { createAnonClient } from "../auth/supabase-anon";
import { tags } from "../cache/public";

/* Cached aggregate count of ACTIVE public committee members, shown in the
   homepage Hero.

   ONLY the COUNT is cached — never member rows or any sensitive data. It is a
   numeric aggregate over a public, RLS-guarded table, so returning a slightly
   stale count can never leak a deleted record's contents.

   We use unstable_cache (not `use cache` / cacheComponents) because enabling
   Cache Components in next.config.ts is incompatible with the app's existing
   `force-dynamic` route segments (admin/contribute/account/summaries) which
   the codebase intentionally keeps dynamic. unstable_cache needs no global
   config, works on the self-hosted Render Node.js server, and supports
   tag-based invalidation via revalidateTag — so it meets the same goal (cache
   the aggregate, invalidate on mutation) without changing any other route.

   We also use the cookie-free anonymous client (createAnonClient) because a
   cache scope cannot read cookies()/headers(), it is a public read, and it
   respects the same public RLS policy the old createClient() path relied on.

   The function returns only the integer count. The cache is revalidated after
   86400s (1 day) AND on-demand via revalidateHeroStats() whenever committee
   membership changes. */
export const getActiveCommitteeMemberCount = unstable_cache(
  async function countActiveCommitteeMembers(): Promise<number> {
    const { count, error } = await createAnonClient()
      .from("committee_members")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);

    if (error || count === null) {
      return 0;
    }
    return count;
  },
  ["public-hero-committee-count"],
  {
    tags: [tags.heroStats],
    revalidate: 60 * 60 * 24,
  }
);
