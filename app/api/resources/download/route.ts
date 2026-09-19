import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getResourceStorageRef } from "../../../../lib/content/data-access";
import { createAdminClient } from "../../../../lib/auth/supabase-server";
import { RESOURCES_BUCKET } from "../../../../lib/content/storage";
import { isCanonicalResourcePath } from "../../../../lib/content/file-format";
import { buildContentDisposition } from "../../../../lib/content/content-disposition";
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
    LIMITERS.resourceAccess, // dedicated resource-traffic limiter (IP key)
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

  /* Defense-in-depth: the DB row is trusted for AUTHORIZATION (is_active) but
     not for the object path. A historical/malicious row could carry an
     arbitrary path, so the value handed to the service-role Storage client must
     match the same canonical contract the application itself issues. Reject
     before any Storage call, and never reveal the path. */
  if (!isCanonicalResourcePath(ref.storagePath, ref.kind)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const admin = createAdminClient();
  /* Stream instead of buffering: the installed @supabase/storage-js (2.112.3)
     download() returns a BlobDownloadBuilder whose .asStream() variant resolves
     to the live fetch Response.body (a web ReadableStream), so the file bytes
     are never materialized fully in server memory. The response is chunked (no
     Content-Length). Security is unchanged: the private-bucket fetch still runs
     with the service-role key server-side, and the storage path/credentials
     never reach the client. */
  const { data, error } = await admin.storage
    .from(RESOURCES_BUCKET)
    .download(ref.storagePath)
    .asStream();

  if (error || !data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  /* Content-Disposition: use the RFC 6266 / RFC 5987 builder which produces an
     ASCII-safe header value regardless of what the stored filename contains
     (Arabic, CJK, emoji, etc.). */
  return new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": ref.mimeType ?? "application/octet-stream",
      "Content-Disposition": buildContentDisposition(ref.fileName),
      "Cache-Control": "private, no-store",
    },
  });
}
