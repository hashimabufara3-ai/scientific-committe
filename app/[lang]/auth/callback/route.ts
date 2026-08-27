import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "../../../../lib/auth/supabase-server";

function resolveDestination(
  next: string | null,
  lang: string
): string {
  return next && next.startsWith("/") && !next.startsWith("//")
    ? next
    : `/${lang}/account`;
}

/* Handles the Supabase auth callback for the two link shapes Supabase Auth
   produces:

   1. OAuth/PKCE links carry `code`. GET exchanges it for a session.
   2. Email confirmation and password-recovery links carry `token_hash` +
      `type`. These are POSTed from the /auth/confirm interstitial, which is the
      only path that verifies the token. Direct GETs carrying a token_hash are
      rejected with 405 so a link scanner or crawler can never consume a
      single-use token.

   Both redirect to the localized destination from the `next` query parameter,
   falling back to the user's account page. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ lang: string }> }
) {
  const { lang } = await params;
  const { searchParams, origin: requestOrigin } = new URL(request.url);
  const origin = process.env.NEXT_PUBLIC_SITE_URL || requestOrigin;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const next = searchParams.get("next");

  const fallback = resolveDestination(next, lang);

  // OAuth / PKCE callback. This is the only GET flow we honor.
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${fallback}`);
    }
    return NextResponse.redirect(
      `${origin}/${lang}/auth/sign-in?error=invalid-link`
    );
  }

  // A GET carrying a token_hash is an automated fetch attempting to verify the
  // token. Never consume a token on GET — reject it.
  if (tokenHash) {
    return new NextResponse("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  // No code and no token — nothing to do.
  return NextResponse.redirect(
    `${origin}/${lang}/auth/sign-in?error=invalid-link`
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ lang: string }> }
) {
  const { lang } = await params;
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;

  const formData = await request.formData();
  const tokenHash = String(formData.get("token_hash") ?? "");
  const type = String(formData.get("type") ?? "");
  const next = formData.get("next");
  const nextValue = typeof next === "string" ? next : null;

  const fallback = resolveDestination(nextValue, lang);

  if (!tokenHash || !type) {
    return NextResponse.redirect(
      `${origin}/${lang}/auth/sign-in?error=invalid-link`
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });
  if (!error) {
    return NextResponse.redirect(`${origin}${fallback}`);
  }

  return NextResponse.redirect(
    `${origin}/${lang}/auth/sign-in?error=invalid-link`
  );
}