import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getClientIP } from "./lib/security/ip";
import { checkProxyRateLimit } from "./lib/security/rate-limit";

/* Origin-access control for the Render origin.

   All public traffic must arrive through Cloudflare, which injects a private
   X-Origin-Access-Secret header. This guard rejects any production request
   that reaches the origin directly (the public *.onrender.com hostname) with
   a 403, before authentication, rate limiting, or any application logic runs.

   NOT user authentication: it is only an origin-access mechanism
   (Cloudflare -> allowed, direct Render -> rejected).

   Behavior:
   - Non-production (local dev): allowed (no Cloudflare required).
   - /api/health: exempted EXACTLY so Render's liveness probe works.
   - ORIGIN_ACCESS_SECRET unset in production: FAIL CLOSED (403 everything
     other than /api/health) so protection can never be silently disabled.
   - Header missing or wrong: 403.

   Constant-time comparison: the supplied and expected values are hashed with
   SHA-256 (Web Crypto, available on the Edge runtime) and the fixed-length
   digests are compared with an XOR accumulator, so timing does not reveal
   where/whether they differ. The secret is never logged, never sent to
   Sentry, and never included in responses. */

const ORIGIN_SECRET_HEADER = "x-origin-access-secret";
const HEALTH_PATH = "/api/health";

async function originAccessAllowed(request: NextRequest): Promise<boolean> {
  /* Local development must not require Cloudflare infrastructure. */
  if (process.env.NODE_ENV !== "production") return true;

  /* Render/external liveness probe — exempt exactly this endpoint only. */
  if (request.nextUrl.pathname === HEALTH_PATH) return true;

  /* Fail closed: production without a configured secret rejects all traffic
     rather than silently leaving the origin protection disabled. */
  const expected = process.env.ORIGIN_ACCESS_SECRET;
  if (!expected) return false;

  const supplied = request.headers.get(ORIGIN_SECRET_HEADER) ?? "";

  console.log("[ORIGIN DEBUG]", {
    production: process.env.NODE_ENV === "production",
    secretConfigured: Boolean(expected),
    headerReceived: Boolean(supplied),
  });

  console.log("[ORIGIN HEADERS DEBUG]", {
    cfIpCountry: Boolean(request.headers.get("cf-ipcountry")),
    trueClientIp: Boolean(request.headers.get("true-client-ip")),
    cfConnectingIp: Boolean(request.headers.get("cf-connecting-ip")),
    cfRay: Boolean(request.headers.get("cf-ray")),
    xForwardedFor: Boolean(request.headers.get("x-forwarded-for")),
    host: Boolean(request.headers.get("host")),
    originSecret: Boolean(request.headers.get("x-origin-access-secret")),
  });

  /* Constant-time comparison via SHA-256 digests (edge-safe). */
  try {
    const encoder = new TextEncoder();
    const [suppliedDigest, expectedDigest] = await Promise.all([
      crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
      crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    ]);
    const suppliedBytes = new Uint8Array(suppliedDigest);
    const expectedBytes = new Uint8Array(expectedDigest);
    let diff = 0;
    for (let i = 0; i < suppliedBytes.length && i < expectedBytes.length; i += 1) {
      diff |= suppliedBytes[i] ^ expectedBytes[i];
    }
    return diff === 0 && suppliedBytes.length === expectedBytes.length;
  } catch {
    /* Hashing failure: fail closed (never allow on error). */
    return false;
  }
}

function forbiddenResponse(): NextResponse {
  return new NextResponse(null, {
    status: 403,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

/* Next.js 16 renamed middleware → proxy. This proxy:
   1. Enforces origin-access control (Cloudflare-only) before anything else.
   2. Applies a global per-IP flood limit (100 req/min) at the edge.
   3. Refreshes Supabase auth session cookies on navigation.
   It performs NO redirects and NO route protection — protected routes enforce
   authentication server-side. If the environment is not configured yet, pass
   requests through untouched. */
export async function proxy(request: NextRequest) {
  /* --- Layer 0: Origin-access control (fail-closed in production) ---
     Runs before rate limiting, auth handling, server actions, and protected
     application logic, so a direct-origin request can never reach them. */
  if (!(await originAccessAllowed(request))) {
    return forbiddenResponse();
  }

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
