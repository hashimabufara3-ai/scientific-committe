import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "../../../../lib/auth/supabase-server";

/* Handles the Supabase auth callback for the two link shapes Supabase Auth
   produces:

   1. Email confirmation and password-recovery links carry `token_hash` +
      `type`. verifyOtp() verifies the token and persists the session through
      the server client's cookie adapter, so the redirect that follows lands on
      an authenticated page.
   2. PKCE links (OAuth, Auth UI flows) carry `code`. exchangeCodeForSession()
      exchanges it for a session.

   Both redirect to the localized destination from the `next` query parameter,
   falling back to the user's account page. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ lang: string }> }
) {
  const { lang } = await params;
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = searchParams.get("next");

  const fallback =
    next && next.startsWith("/") && !next.startsWith("//")
      ? next
      : `/${lang}/account`;

  const supabase = await createClient();

  // Email confirmation (type=email/signup) and password recovery
  // (type=recovery) links issued by the email templates.
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error) {
      return NextResponse.redirect(`${origin}${fallback}`);
    }
  }

  // PKCE / OAuth callback.
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${fallback}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/${lang}/auth/sign-in?error=invalid-link`
  );
}
