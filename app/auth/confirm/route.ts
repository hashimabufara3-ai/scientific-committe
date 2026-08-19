import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/* Redirect shim for the default Supabase email-template link shape:

   {{ .SiteURL }}/auth/confirm?token_hash=…&type=…&redirect_to=…

   The email template is configured in the Supabase Dashboard and cannot use a
   localized prefix.  This route extracts token_hash, type and the `next`
   destination from `redirect_to`, then forwards them to the real localized
   callback handler. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const redirectTo = searchParams.get("redirect_to");

  let lang = "ar";
  let next = searchParams.get("next");

  if (redirectTo) {
    try {
      const target = new URL(redirectTo);
      const targetNext = target.searchParams.get("next");
      if (targetNext) next = targetNext;
      if (targetNext?.startsWith("/en")) lang = "en";
    } catch {
      /* not a valid URL — keep defaults */
    }
  }

  const cb = new URL(`${origin}/${lang}/auth/callback`);
  if (tokenHash) cb.searchParams.set("token_hash", tokenHash);
  if (type) cb.searchParams.set("type", type);
  if (next) cb.searchParams.set("next", next);

  return NextResponse.redirect(cb.toString());
}
