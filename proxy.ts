import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getClientIP } from "./lib/security/ip";
import { checkProxyRateLimit } from "./lib/security/rate-limit";
import { diag, shortId } from "./lib/auth/diag-log";

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
    // TEMP-DIAG
    const pn = request.nextUrl.pathname;
    if (pn.startsWith("/auth/confirm") || pn.includes("/auth/callback")) {
      diag("proxy:flood-block", {
        correlation: shortId(),
        method: request.method,
        pathname: pn,
        result: "429-rate-limited",
        status: 429,
      });
    }
    return new NextResponse("Too Many Requests", {
      status: 429,
      headers: { "Retry-After": "60" },
    });
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
