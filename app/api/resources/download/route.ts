import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getResourceStorageRef } from "../../../../lib/content/data-access";
import { createAdminClient } from "../../../../lib/auth/supabase-server";
import { RESOURCES_BUCKET } from "../../../../lib/content/storage";
import {
  checkProxyRateLimit,
  checkRateLimit,
  LIMITERS,
} from "../../../../lib/security/rate-limit";
import { getClientIP } from "../../../../lib/security/ip";

/* Same-origin file download endpoint.

   The signatures/bytes live in a PRIVATE Supabase Storage bucket. A short-lived
   signed URL works for View (opened in a new tab), but Download cannot rely on
   it: the browser IGNORES the `download` attribute for cross-origin URLs, so
   an <a> pointed at *.supabase.co would navigate the current tab to the file
   and leave the /summaries page. Instead this endpoint:

     1. Validates the requested resource is ACTIVE (via the same RLS-guarded
        public-read client used by the access route).
     2. Fetches the object bytes SERVER-SIDE with the service-role client (the
        server already holds the only key that reads the private bucket; the
        browser never receives Storage credentials or a signed URL).
     3. Streams the bytes back as a same-origin response with
        Content-Disposition: attachment and the correct Content-Type, so the
        browser saves the file with its real filename and stays on the page.

   Security is unchanged: the private bucket stays private, neither RLS nor
   auth is weakened, and this endpoint is rate-limited by IP exactly like the
   access route. Publicly accessible, active summaries are downloadable by
   visitors — the intended access policy — because the row is verified active. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind");
  const id = searchParams.get("id");

  const ip = getClientIP(request);

  const { success: proxyOk } = await checkProxyRateLimit(ip);
  if (!proxyOk) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const { success: ipOk } = await checkRateLimit(
    LIMITERS.signInIp, // reuse a burst limiter suitable for an IP key
    `resources:download:${ip ?? "unknown"}`
  );
  if (!ipOk) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  if (!id || (kind !== "summary" && kind !== "exam")) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const ref = await getResourceStorageRef(kind, id);
  if (!ref) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(RESOURCES_BUCKET)
    .download(ref.storagePath);

  if (error || !data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const bytes = await data.arrayBuffer();

  /* Sanitize the client-provided stored filename for the Content-Disposition
     header: strip CR/LF (header-injection) and any surrounding quotes/double
     quotes, then fall back to a safe default. */
  const rawName = ref.fileName || "download";
  const safeName =
    rawName
      .replace(/[\r\n\u2028\u2029"]+/g, "")
      .trim()
      .slice(0, 200) || "download";

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": ref.mimeType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
