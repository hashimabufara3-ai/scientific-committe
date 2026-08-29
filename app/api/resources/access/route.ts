import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getExamAccessUrl,
  getSummaryAccessUrl,
} from "../../../../lib/content/data-access";
import {
  checkProxyRateLimit,
  checkRateLimit,
  LIMITERS,
} from "../../../../lib/security/rate-limit";

/* On-demand signed-URL endpoint for viewing/downloading a resource file.

   Students never receive Storage credentials or raw file bytes from the server
   render. A resource card only holds a reference (kind + id). When the user
   explicitly chooses View or Download, this endpoint returns a SHORT-LIVED
   signed URL to the private object.

   Security:
   - The requested resource is validated against the ACTIVE row before a URL is
     minted (via the public-read helpers + anonymous client, RLS-guarded).
   - Rate limited by IP (per-user auth is not required for students, so IP is
     the only stable key available without a session).
   - The signed URL itself is short-lived and scoped to that one object; the
     path is never exposed to the client. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind");
  const id = searchParams.get("id");

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    null;
  const { success: proxyOk } = await checkProxyRateLimit(ip);
  if (!proxyOk) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const { success: ipOk } = await checkRateLimit(
    LIMITERS.signInIp, // reuse a burst limiter suitable for an IP key
    `resources:access:${ip ?? "unknown"}`
  );
  if (!ipOk) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  if (!id || (kind !== "summary" && kind !== "exam")) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const url =
    kind === "summary"
      ? await getSummaryAccessUrl(id)
      : await getExamAccessUrl(id);

  if (!url) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ url });
}
