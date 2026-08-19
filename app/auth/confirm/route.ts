import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/* Confirmation interstitial for the default Supabase email-template link shape:

   {{ .SiteURL }}/auth/confirm?token_hash=…&type=…&redirect_to=…

   The email template is configured in the Supabase Dashboard and cannot use a
   localized prefix. This route renders a minimal HTML page with a native form.

   Email recovery/signup tokens are single-use. The page never verifies the
   token itself and never navigates automatically: no <a href>, no meta
   refresh, and no JavaScript. The token_hash exists only as a hidden form
   input value — never inside a URL in the HTML — so a link scanner or mail
   preview that fetches this page cannot discover or consume the token. The
   token is only sent to the localized callback when the user physically
   submits the POST form via the Continue button.

   It preserves: token_hash, type, next, Arabic/English detection, redirect_to
   parsing, the next validation rules and the NEXT_PUBLIC_SITE_URL origin
   preference used by the callback. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const redirectTo = searchParams.get("redirect_to");

  // Preserve the existing language detection: Arabic by default, English when
  // the realized destination path is /en/….
  let lang = "ar";
  let next = searchParams.get("next");

  if (redirectTo) {
    try {
      const target = new URL(redirectTo);
      const targetNext = target.searchParams.get("next");
      if (targetNext) next = targetNext;
    } catch {
      /* not a valid URL — keep defaults */
    }
  }

  // Reuse the callback's open-redirect rule: only internal paths are trusted.
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    if (next.startsWith("/en")) lang = "en";
  } else {
    next = null;
  }

  const html = interstitialHtml({ lang, tokenHash, type, next });

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, private",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'self'",
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function interstitialHtml({
  lang,
  tokenHash,
  type,
  next,
}: {
  lang: string;
  tokenHash: string | null;
  type: string | null;
  next: string | null;
}): string {
  const dir = lang === "en" ? "ltr" : "rtl";
  const isEn = lang === "en";

  const title = isEn ? "Confirm to continue" : "تأكيد للمتابعة";
  const heading = isEn ? "Confirm to continue" : "تأكيد للمتابعة";
  const body = isEn
    ? "A link was sent to your email to confirm an action on your account. Click the button below to continue. If you did not request this, you can close this page."
    : "أُرسل رابط إلى بريدك الإلكتروني لتأكيد إجراء على حسابك. اضغط على الزر أدناه للمتابعة. إذا لم تكن قد طلبت ذلك، يمكنك إغلاق هذه الصفحة.";
  const label = isEn ? "Continue" : "متابعة";

  const hiddenToken = tokenHash ? `<input type="hidden" name="token_hash" value="${escapeHtml(tokenHash)}" />` : "";
  const hiddenType = type ? `<input type="hidden" name="type" value="${escapeHtml(type)}" />` : "";
  const hiddenNext = next ? `<input type="hidden" name="next" value="${escapeHtml(next)}" />` : "";

  return `<!doctype html>
<html lang="${isEn ? "en" : "ar"}" dir="${dir}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${title}</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center;
             background: #f4f6f8; color: #1a202c;
             font-family: system-ui, -apple-system, "Segoe UI", Roboto,
               "Noto Kufi Arabic", Tahoma, Arial, sans-serif; }
      main { max-width: 26rem; margin: 1.5rem; padding: 2rem; background: #fff;
             border: 1px solid #e2e8f0; border-radius: 0.75rem;
             box-shadow: 0 1px 3px rgba(0,0,0,0.08); text-align: center; }
      h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
      p { font-size: 0.95rem; line-height: 1.6; margin: 0 0 1.5rem; }
      button { font: inherit; font-size: 1rem; font-weight: 600; padding: 0.7rem 1.6rem;
               border: 0; border-radius: 0.5rem; cursor: pointer;
               background: #0f766e; color: #fff; }
      button:focus-visible { outline: 3px solid #5eead4; outline-offset: 2px; }
    </style>
  </head>
  <body>
    <main>
      <h1>${heading}</h1>
      <p>${body}</p>
      <form method="POST" action="/${escapeHtml(lang)}/auth/callback">
        ${hiddenToken}
        ${hiddenType}
        ${hiddenNext}
        <button type="submit">${label}</button>
      </form>
    </main>
  </body>
</html>`;
}