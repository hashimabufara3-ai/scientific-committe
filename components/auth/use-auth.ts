"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { isRole, type Role } from "../../lib/auth/roles";

/* Reactive current-user state for the navbar. Validates the session with
   getUser() once on mount, then stays in sync with onAuthStateChange.
   Removed pathname dependency — auth state does not change on navigation,
   and re-fetching getUser() on every route transition was an unnecessary
   network round-trip that slowed mobile navigation. */
export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    import("../../lib/auth/supabase-browser")
      .then(({ createClient }) => createClient())
      .then((supabase) => {
        supabase.auth
          .getUser()
          .then(({ data }) => {
            if (!active) return;
            setUser(data.user);
            setLoading(false);
          })
          .catch(() => {
            if (active) {
              setUser(null);
              setLoading(false);
            }
          });

        const { data: subscription } = supabase.auth.onAuthStateChange(
          (_event, session) => {
            if (!active) return;
            setUser(session?.user ?? null);
            setLoading(false);
          }
        );
        unsubscribe = subscription.subscription.unsubscribe;
      })
      .catch(() => {
        if (active) {
          setUser(null);
          setLoading(false);
        }
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  return { user, loading };
}

/* Reactive current-role state for the navbar. Takes the caller's own user id
   (a stable primitive) and reads that profile row through RLS (every
   authenticated user may read their own profile). The effect depends only on
   the user id, never the whole user object reference, so two representations
   of the same authenticated user (the getUser() response and the
   INITIAL_SESSION session) do not trigger a second profile query. Navigation
   visibility is UX only — server-side requireRole() is the authoritative
   gate. */
export function useRole(userId: string | null) {
  const [state, setState] = useState<{
    userId: string | null;
    role: Role | null;
  }>({ userId: null, role: null });

  useEffect(() => {
    if (!userId) return;
    let active = true;

    import("../../lib/auth/supabase-browser")
      .then(({ createClient }) => createClient())
      .then((supabase) =>
        supabase.from("profiles").select("role").eq("id", userId).maybeSingle()
      )
      .then(({ data }) => {
        if (!active) return;
        setState({
          userId,
          role: isRole(data?.role) ? data.role : null,
        });
      })
      .catch(() => {
        if (active) setState({ userId, role: null });
      });

    return () => {
      active = false;
    };
  }, [userId]);

  /* Only surface a role that belongs to the current session user — never a
     stale role from a previously signed-in account. */
  const role = userId && state.userId === userId ? state.role : null;
  return { role };
}
