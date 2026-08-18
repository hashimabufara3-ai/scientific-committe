import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/* Next.js 16 renamed middleware → proxy. This proxy only refreshes Supabase
   auth session cookies on navigation. It performs NO redirects and NO route
   protection — protected routes enforce authentication server-side. If the
   environment is not configured yet, pass requests through untouched. */
export async function proxy(request: NextRequest) {
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
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Run on pages, routes and server functions, but skip static assets,
    // images and downloaded files (public/files/*).
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|mp4|pdf|txt)$).*)",
  ],
};
