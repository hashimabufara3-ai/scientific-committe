import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "../../../../lib/auth/supabase-server";
import { captureActionError } from "../../../../lib/security/sentry";

export const dynamic = "force-dynamic";

/* Recovery-email verification completion.

   This route is reached ONLY after the existing localized auth callback has
   already consumed a native Supabase recovery link (delivered to the external
   recovery address) and established the recovery session. It does NOT consume
   any token itself — it simply marks the caller's recovery email as verified
   and redirects to the account page. This reuses the existing confirm/callback
   POST-only token-consumption chain unchanged rather than introducing a second
   callback implementation. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ lang: string }> }
) {
  const { lang } = await params;
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/${lang}/auth/sign-in`);
  }

  const { error } = await supabase.rpc("confirm_recovery_email");
  if (error) {
    /* Non-fatal: the session still exists. Surface a conservative state. */
    captureActionError(error, "confirm_recovery_email failed", {
      action: "verifyRecoveryEmail",
      route: `/${lang}/auth/verify-recovery-email`,
      code: error.code,
    });
  }

  return NextResponse.redirect(`${origin}/${lang}/account?recovery=verified`);
}
