import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/* Redirect shim for Supabase confirmation/recovery links whose URL was
   configured WITHOUT the localized /:lang prefix (e.g. an email template with
   `{{ .SiteURL }}/auth/callback`). Those links 404 against the fully-localized
   route table, so forward them into the real localized handler, deriving the
   language from the `next` param when present. The `code`/`token_hash`/`type`
   query params are preserved untouched. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const next = searchParams.get("next");
  const lang = next?.startsWith("/ar") ? "ar" : "en";
  const query = searchParams.toString();

  return NextResponse.redirect(
    `${origin}/${lang}/auth/callback${query ? `?${query}` : ""}`
  );
}
