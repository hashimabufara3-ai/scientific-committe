import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "./supabase-server";
import { isAtLeast, isRole, type Role } from "./roles";

/* Server-side authorization helpers.

   Server components and Server Actions are the only places where access is
   decided. Role is always re-read from the database (never trusted from client
   state), so privilege changes — including an ownership transfer — take effect
   on the very next request. */

export type SessionRole = {
  user: User;
  role: Role;
};

export type SessionWithOptionalRole = {
  user: User;
  role: Role | null;
  /* True when this profile is flagged for a forced password change. The proxy
     enforces this on navigation; Server Actions (which skip the proxy Supabase
     layers) enforce it themselves via authorizeContributor(). Always read from
     the database — never trusted from the client. */
  mustChangePassword: boolean;
};

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/* Authenticated user plus a reusable server client. Callers that only need the
   user id (e.g. to start a rate-limit check) can use this without first waiting
   for the profile read. Authoritative: getUser() always validates the session
   against Supabase Auth; nothing is trusted from the client. */
export async function getSessionUser(): Promise<{
  user: User;
  supabase: ServerClient;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { user, supabase };
}

/* Map the database profile (role + forced-password flag) onto the session
   shape. Both fields are always read from the database by the caller; a missing
   or failed profile yields a null role, which authorization then rejects. */
export function buildSessionWithRole(
  user: User,
  profile: { role?: unknown; must_change_password?: boolean } | null
): SessionWithOptionalRole {
  return {
    user,
    role: isRole(profile?.role) ? profile.role : null,
    mustChangePassword: Boolean(profile?.must_change_password),
  };
}

/* Current session + role, or null when not authenticated. The role and the
   must_change_password flag are fetched from the profile in ONE database
   round trip. */
export async function getSessionRole(): Promise<SessionWithOptionalRole | null> {
  const au = await getSessionUser();
  if (!au) return null;

  const { data: profile } = await au.supabase
    .from("profiles")
    .select("role, must_change_password")
    .eq("id", au.user.id)
    .maybeSingle();

  return buildSessionWithRole(au.user, profile);
}

/* Require an authenticated session with at least the given role.

   - Not authenticated  -> redirect to sign-in.
   - Role missing/too low -> redirect to the localized home page.

   Returns the narrowed session (role is guaranteed to be present and
   high enough). */
export async function requireRole(
  lang: string,
  min: Role
): Promise<SessionRole> {
  const session = await getSessionRole();
  if (!session) {
    redirect(`/${lang}/auth/sign-in?next=/${lang}`);
  }
  if (session.role === null || !isAtLeast(session.role, min)) {
    redirect(`/${lang}`);
  }
  return { user: session.user, role: session.role };
}
