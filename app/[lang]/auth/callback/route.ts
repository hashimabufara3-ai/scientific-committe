import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "../../../../lib/auth/supabase-server";
import { diag, shortId } from "../../../../lib/auth/diag-log";

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
  const corr = shortId();
  const { searchParams, origin: requestOrigin } = new URL(request.url);
  const origin = process.env.NEXT_PUBLIC_SITE_URL || requestOrigin;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const next = searchParams.get("next");

  // TEMP-DIAG
  diag("callback:GET", {
    correlation: corr,
    method: "GET",
    lang,
    hasToken: !!tokenHash,
    hasCode: !!code,
    next,
    ua: request.headers.get("user-agent") ?? undefined,
  });

  const fallback = resolveDestination(next, lang);

  // OAuth / PKCE callback. This is the only GET flow we honor.
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    // TEMP-DIAG
    diag("exchangeCode", {
      correlation: corr,
      method: "GET",
      result: error ? "error" : "success",
      name: error?.name,
      status: error?.status,
      message: error?.message,
    });
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
    // TEMP-DIAG
    diag("callback:GET-token-blocked", {
      correlation: corr,
      method: "GET",
      lang,
      result: "405-method-not-allowed",
      status: 405,
    });
    return new NextResponse("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  // No code and no token — nothing to do.
  // TEMP-DIAG
  diag("callback:GET-noop", {
    correlation: corr,
    method: "GET",
    lang,
    result: "no-code-no-token",
    status: "redirect-invalid-link",
  });
  return NextResponse.redirect(
    `${origin}/${lang}/auth/sign-in?error=invalid-link`
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ lang: string }> }
) {
  const { lang } = await params;
  const corr = shortId();
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;

  const formData = await request.formData();
  const tokenHash = String(formData.get("token_hash") ?? "");
  const type = String(formData.get("type") ?? "");
  const next = formData.get("next");
  const nextValue = typeof next === "string" ? next : null;

  // TEMP-DIAG
  diag("callback:POST", {
    correlation: corr,
    method: "POST",
    lang,
    type: type || undefined,
    hasToken: !!tokenHash,
    hasType: !!type,
    next: nextValue,
    ua: request.headers.get("user-agent") ?? undefined,
  });

  const fallback = resolveDestination(nextValue, lang);

  if (!tokenHash || !type) {
    // TEMP-DIAG
    diag("callback:POST-missing-fields", {
      correlation: corr,
      method: "POST",
      lang,
      hasToken: !!tokenHash,
      hasType: !!type,
      result: "invalid-link",
    });
    return NextResponse.redirect(
      `${origin}/${lang}/auth/sign-in?error=invalid-link`
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });
  // TEMP-DIAG
  diag("verifyOtp", {
    correlation: corr,
    method: "POST",
    type,
    lang,
    result: error ? "error" : "success",
    name: error?.name,
    status: error?.status,
    message: error?.message,
  });
  if (!error) {
    // TEMP-DIAG
    diag("callback:POST-success-redirect", {
      correlation: corr,
      method: "POST",
      type,
      lang,
      next: fallback,
      result: "redirect",
    });
    return NextResponse.redirect(`${origin}${fallback}`);
  }

  // TEMP-DIAG
  diag("callback:POST-error-redirect", {
    correlation: corr,
    method: "POST",
    type,
    lang,
    result: "invalid-link",
  });
  return NextResponse.redirect(
    `${origin}/${lang}/auth/sign-in?error=invalid-link`
  );
}