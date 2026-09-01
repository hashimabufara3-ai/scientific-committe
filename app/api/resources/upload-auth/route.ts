import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionRole } from "../../../../lib/auth/authorize";
import {
  checkRateLimit,
  LIMITERS,
} from "../../../../lib/security/rate-limit";
import {
  createSignedUploadUrl,
  quarantineStoragePath,
  validateFileUpload,
} from "../../../../lib/content/storage";

/* Server-side upload AUTHORIZATION (no file bytes pass through here).

   The browser sends only upload METADATA and receives a short-lived signed
   upload URL scoped to a server-generated quarantine path. The actual file is
   then PUT directly from the browser to the private Supabase Storage bucket, so
   the multipart body never transits Render.

   The server remains authoritative:
     - authenticates the actor (contributor/admin/owner, cookie-bound session);
     - applies the existing rate limiter;
     - validates MIME + size with the existing authoritative validator (PDF
       only, <= 3 MB);
     - generates the object path itself (quarantine/<user>/<uuid>.pdf) — the
       client can never pick a path;
     - issues a SHORT-LIVED signed upload URL for exactly that path. The
       service-role key is never exposed, and the signedUrl/token cannot be
       reused beyond its expiry or for any other path.

   The uploaded quarantine object is NOT yet validated: the actual stored bytes
   are re-read (size + PDF magic bytes, first 1 KB) and the object is moved to
   its canonical path by finalizeStoredUpload() inside the resource Server
   Actions before any metadata row can reference it. */
export async function POST(request: NextRequest) {
  const session = await getSessionRole();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (
    session.role !== "contributor" &&
    session.role !== "admin" &&
    session.role !== "owner"
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { success: allowed } = await checkRateLimit(
    LIMITERS.adminAction,
    `resources:upload:${session.user.id}`
  );
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: { kind?: unknown; mimeType?: unknown; size?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const kind = body.kind === "exam" ? "exam" : "summary";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType.trim() : "";
  const size = typeof body.size === "number" ? body.size : NaN;

  /* Same authoritative validator the old upload route used. */
  const validation = validateFileUpload(mimeType, size);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 422 });
  }

  const path = quarantineStoragePath(session.user.id);
  const signed = await createSignedUploadUrl(path);
  if (!signed) {
    return NextResponse.json({ error: "upload_failed" }, { status: 502 });
  }

  return NextResponse.json({
    signedUrl: signed.signedUrl,
    token: signed.token,
    path,
  });
}