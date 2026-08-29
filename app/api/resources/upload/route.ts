import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionRole } from "../../../../lib/auth/authorize";
import {
  checkRateLimit,
  LIMITERS,
} from "../../../../lib/security/rate-limit";
import {
  examStoragePath,
  summaryStoragePath,
  uploadResource,
  validateFileUpload,
} from "../../../../lib/content/storage";

/* Server-side file upload for the Resources/Summaries section.

   IMPORTANT: this is a Route Handler (not a Server Action) on purpose.
   Next.js caps Server Action request bodies at 1 MB by default, but the
   existing upload UX allows files up to 2 MB. A Route Handler is not subject
   to that action-body cap.

   The request is multipart/form-data carrying the RAW browser File (never a
   base64 data URL). The bytes are written directly to Supabase Storage. They
   are NEVER:
     - decoded/re-encoded as base64,
     - stored in localStorage, React persistent state, PostgreSQL, or a Server
       Action argument,
     - returned to the client (the response exposes only the storage path and
       display metadata).

   This endpoint ONLY writes object BYTES to Storage. It does NOT create or
   mutate any metadata row. The caller then persists metadata (associating the
   returned storage path) through the server actions in
   app/[lang]/contribute/actions.ts, which are the single place DB rows are
   written and cleaned up on failure.

   Security:
   - Authenticates the actor with the cookie-bound session and requires at
     least contributor (the same gate the workflow page enforces).
   - Applies the existing rate limiter.
   - Validates the ACTUAL uploaded bytes server-side: MIME on the allowlist
     and size <= MAX_UPLOAD_BYTES.
   - The object path is generated server-side (UUID-based, e.g.
     summaries/<uuid>.pdf) — never taken from the client — and does not
     require the subject id. */

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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const file = formData.get("file");
  const kind = formData.get("kind") === "exam" ? "exam" : "summary";
  if (!(file instanceof File) || file.size === 0 || !file.name) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const validation = validateFileUpload(file.type, file.size);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 422 });
  }

  try {
    const bytes = await file.arrayBuffer();
    const path =
      kind === "exam"
        ? examStoragePath(file.type)
        : summaryStoragePath(file.type);
    await uploadResource(path, bytes, file.type);
    return NextResponse.json({
      path,
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
    });
  } catch {
    return NextResponse.json({ error: "upload_failed" }, { status: 502 });
  }
}