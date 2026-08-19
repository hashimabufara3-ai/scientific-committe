import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/* Confirmation interstitial for the default Supabase email-template link shape:

   {{ .SiteURL }}/auth/confirm?token_hash=…&type=…&redirect_to=…

   The email template is configured in the Supabase Dashboard and cannot use a
   localized prefix. This route renders a minimal HTML page instead of
   redirecting automatically.

   Email recovery/signup tokens are single-use. An automatic 302 here let a
   link scanner or mail preview consume the token before the user clicked. This
   page never verifies the token and never makes a request to the callback; the
   callback URL is only constructed and navigated to when the user clicks the
   Continue button, so scanners that fetch this URL alone cannot burn the token.

   It preserves: token_hash, type, next, Arabic/English language detection and
   the NEXT_PUBLIC_SITE_URL origin preference used by the callback. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const { origin: requestOrigin } = request.nextUrl;
  const origin = process.env.NEXT_PUBLIC_SITE_URL || requestOrigin;

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

  const cb = new URL(`${origin}/${lang}/auth/callback`);
  if (tokenHash) cb.searchParams.set("token_hash", tokenHash);
  if (type) cb.searchParams.set("type", type);
  if (next) cb.searchParams.set("next", next);

  const html = interstitialHtml({ lang, cb: cb.toString() });

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, private",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'",
    },
  });
}

function interstitialHtml({
  lang,
  cb,
}: {
  lang: string;
  cb: string;
}): string {
  const dir = lang === "en" ? "ltr" : "rtl";
  const isEn = lang === "en";

  const title = isEn ? "Confirm to continue" : "تأكيد للمتابعة";
  const heading = isEn ? "Confirm to continue" : "تأكيد للمتابعة";
  const body = isEn
    ? "A link was sent to your email to confirm an action on your account. Click the button below to continue. If you did not request this, you can close this page."
    : "أُرسل رابط إلى بريدك الإلكتروني لتأكيد إجراء على حسابك. اضغط على الزر أدناه للمتابعة. إذا لم تكن قد طلبت ذلك، يمكنك إغلاق هذه الصفحة.";
  const label = isEn ? "Continue" : "متابعة";
  const noscript = isEn
    ? "JavaScript is required to continue. Please enable JavaScript and click the button again."
    : "يجب تفعيل جافاسكربت للمتابعة. الرجاء تفعيله ثم الضغط على الزر مرة أخرى.";

  // Only the button click handler knows the callback URL. It is not present as
  // an <a href>, <form action> or <meta refresh>, so automated fetchers of this
  // page cannot reach the callback (and cannot consume the single-use token).
  const goTo = JSON.stringify(cb);

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
      .sm { font-size: 0.8rem; color: #64748b; margin-top: 1.25rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>${heading}</h1>
      <p>${body}</p>
      <button type="button" id="continue-btn">${label}</button>
      <noscript><p class="sm">${noscript}</p></noscript>
    </main>
    <script>
      (function () {
        var target = ${goTo};
        document.getElementById("continue-btn").addEventListener("click", function () {
          window.location.assign(target);
        });
      })();
    </script>
  </body>
</html>`;
}