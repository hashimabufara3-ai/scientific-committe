import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getClientIP } from "./lib/security/ip";
import { checkProxyRateLimit } from "./lib/security/rate-limit";

/* Next.js 16 renamed middleware → proxy. This proxy:
   1. Applies a global per-IP flood limit (100 req/min) at the edge.
   2. Refreshes Supabase auth session cookies on navigation.
   It performs NO redirects and NO route protection — protected routes enforce
   authentication server-side. If the environment is not configured yet, pass
   requests through untouched. */
export async function proxy(request: NextRequest) {
  /* --- Layer 1: Global IP flood protection (fail-open) --- */
  const ip = getClientIP(request);
  const { success: allowed } = await checkProxyRateLimit(ip);
  if (!allowed) {
    return new NextResponse("Too Many Requests", {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  }

  /* Server Action POSTs and authenticated RSC sub-requests for PROTECTED
     routes (contribute/admin) re-authenticate server-side inside the request:
     Server Actions via authorizeContributor(), protected Server Components via
     requireRole() — both run authoritative getUser() plus the database profile
     read (role + must_change_password) and enforce the forced-password
     redirect. Running the proxy's duplicate session refresh + profile lookup
     again on those requests only adds repeated Supabase round trips for the
     same user. Skip only the Supabase layers when:
       - the request is a Server Action (Next-Action header), OR
       - the request is a client RSC sub-request (the App Router emits the
         `rsc` header / `?_rsc=` query) FOR a protected route.
     The global IP flood limit above still applies to every request, and cookie
     refresh + must_change_password enforcement stay in the proxy for all
     normal (non-RSC) document requests, auth/change-password routes, Route
     Handlers and all publicly-accessible pages. */
  const isProtectedRoute =
    /^\/(en|ar)\/(contribute|admin)(\/|$)/.test(request.nextUrl.pathname);
  const isRscSubrequest =
    request.headers.has("rsc") || request.nextUrl.searchParams.has("_rsc");
  if (
    request.headers.has("Next-Action") ||
    (isProtectedRoute && isRscSubrequest)
  ) {
    return NextResponse.next({ request });
  }

  /* --- Layer 2: Supabase session refresh --- */
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANT: nothing may run between createServerClient and auth.getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  /* --- Layer 3: must_change_password enforcement ---
     If the user is forced to change their password, redirect them to the
     change-password page on every navigation. Exclude auth routes to avoid
     redirect loops. */
  if (user) {
    const pathname = request.nextUrl.pathname;
    const isChangePasswordRoute = /\/auth\/change-password/.test(pathname);
    const isAuthRoute = /\/auth\//.test(pathname);

    if (!isChangePasswordRoute && !isAuthRoute) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("must_change_password")
        .eq("id", user.id)
        .single();

      if (profile?.must_change_password) {
        const lang = pathname.split("/")[1] || "en";
        const changePasswordUrl = new URL(
          `/${lang}/auth/change-password`,
          request.url
        );
        return NextResponse.redirect(changePasswordUrl);
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Run on pages, routes and server functions, but skip static assets,
    // images and downloaded files (public/files/*).
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|mp4|pdf|txt)$).*)",
  ],
};
