import { createAdminClient } from "../auth/supabase-server";
import { logger } from "../logger";
import {
  CHECK_HEADER_BYTES,
  MAX_UPLOAD_BYTES,
  allowedExtension,
  mimeFromExtension,
  resolveUploadFormat,
} from "./file-format";

/* Re-exported so existing importers of lib/content/storage keep working while
   the single source of truth for the upload rules stays file-format.mjs. */
export { MAX_UPLOAD_BYTES, validateFileUpload } from "./file-format";

/* Server-side env access for the storage REST helpers (the admin client does
   not expose the project URL/keys). These must never be imported by browser
   code — this module already requires the server-only supabase-server. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing Supabase environment variable: ${name}.`);
  }
  return value;
}

/* Server-only Supabase Storage helpers for the Resources/Summaries section.

   The bucket is PRIVATE ("resources"). There are no client upload policies, so
   every write goes through these functions using the service-role client
   (server-only, never exposed to the browser). Reading is done via
   short-lived signed URLs so file bytes never land in RSC payloads, React
   state or localStorage.

   Path convention (safe, generated — never the raw upload filename):
     summaries/<uuid>.<ext>
     exams/<uuid>.<ext>

   The path is opaque to the database (only stored as a reference), so the
   subject id is NOT embedded in the object path. This keeps upload ordering
   independent of subject creation (a brand-new subject's uploads can happen
   before or after subject creation) while the metadata row ties everything to
   the subject.
*/

export const RESOURCES_BUCKET = "resources";

/* The allowed upload formats, the size cap and the magic-byte signature rules
   live in ./file-format (dependency-free) so they are unit-testable and shared
   with the client. NEW uploads are PDF plus common raster images; SVG is
   intentionally excluded (raw-object serving would expose script content).
   Existing files of previously-allowed types keep their behavior. */

function uuid(): string {
  return crypto.randomUUID();
}

/* Generate a safe object path for a summary upload. */
export function summaryStoragePath(mime: string): string {
  const ext = allowedExtension(mime) ?? "bin";
  return `summaries/${uuid()}.${ext}`;
}

/* Generate a safe object path for an exam file upload. */
export function examStoragePath(mime: string): string {
  const ext = allowedExtension(mime) ?? "bin";
  return `exams/${uuid()}.${ext}`;
}

/* ---------------------------------------------------------------------------
   Direct-to-Storage uploads (signed upload URLs).

   Flow: the browser asks a server endpoint for a SHORT-LIVED signed upload URL
   scoped to a server-generated quarantine path, PUTs the file straight to the
   private bucket (the 3 MB body never passes through Render), then the server
   re-reads the actual stored object (size + format magic bytes), moves it to
   the canonical path, and only then writes metadata. The quarantine object is
   never referenced by any resource row before validation and finalization.
   --------------------------------------------------------------------------- */

/* Quarantine prefix: objects here are untrusted until validate + move. */
export const QUARANTINE_PREFIX = "quarantine/";

/* Server-generated, user-scoped quarantine path. The user's id is embedded so
   the finalize step can reject references to anyone else's pending object.
   The extension mirrors the DECLARED (already allowlisted) MIME so the
   object's content type is inferred correctly for the browser PUT, while the
   actual bytes are still re-validated against that declared type during
   finalization. */
export function quarantineStoragePath(userId: string, mime: string): string {
  const ext = allowedExtension(mime) ?? "bin";
  return `${QUARANTINE_PREFIX}${userId}/${uuid()}.${ext}`;
}

/* Issue a short-lived signed upload URL for exactly `path` (server-generated
   quarantine path). The returned signedUrl/token are scoped to that one object
   and expire (storage-js default signed-upload TTL); the service-role key is
   never exposed. The object is validated and moved out of quarantine by
   finalizeStoredUpload shortly afterwards. */
export async function createSignedUploadUrl(path: string): Promise<{
  signedUrl: string;
  token: string;
  path: string;
} | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(RESOURCES_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data?.signedUrl || !data?.token) return null;
  return { signedUrl: data.signedUrl, token: data.token, path: data.path ?? path };
}

/* Stored-object metadata (size / mimetype) via the Storage info endpoint.
   The @supabase/storage-js 2.112.3 info() response is camel-cased and typed as
   FileObjectV2, where the size lives under `metadata.size` /
   `metadata.contentLength` (both numbers). This helper also tolerates the size
   arriving as a numeric string or on a top-level `size` field, but only ever
   accepts a finite number — any error (or an object whose size cannot be
   derived) fails closed (returns null). */
export async function getStoredObjectInfo(path: string): Promise<{
  size: number;
  mimetype: string | null;
} | null> {
  const admin = createAdminClient();
  const res = await admin.storage.from(RESOURCES_BUCKET).info(path);
  const error = res.error;
  const data = res.data;

  /* Case 1 — info() itself errored / object not found. Fail closed, but record
     the sub-reason so production logs can tell "endpoint error" apart from
     "data but size missing". Never log the path, tokens, or credentials. */
  if (error || !data) {
    const status =
      typeof (error as { status?: unknown } | null)?.status === "number"
        ? (error as { status: number }).status
        : undefined;
    const message = (error?.message ?? "")
      .replace(/[^\s]*quarantine[^\s]*/gi, "[redacted]")
      .slice(0, 300);
    logger.warn("finalize: storage info() failed", {
      step: "info",
      infoError: true,
      objectExists: false,
      status,
      message,
    });
    return null;
  }

  /* Case 2 — data returned, but we must derive a finite numeric size from the
     actual shape (metadata can be null, and size can be a number or a numeric
     string on this or the top level). If none is usable, fail closed. */
  const rawMetadata = (data as { metadata?: unknown }).metadata;
  const md =
    rawMetadata && typeof rawMetadata === "object"
      ? (rawMetadata as Record<string, unknown>)
      : {};

  const candidates: unknown[] = [
    md.size,
    md.contentLength,
    md.content_length,
    (data as { size?: unknown }).size,
  ];
  let size: number | null = null;
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      size = value;
      break;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        size = parsed;
        break;
      }
    }
  }
  if (size === null) {
    logger.warn("finalize: storage info() returned no usable size", {
      step: "info",
      objectExists: true,
      sizeMissing: true,
      metadataPresent: Object.keys(md).length > 0,
      metadataKeys: Object.keys(md).slice(0, 20),
    });
    return null;
  }

  const mimetype = typeof md.mimetype === "string" ? md.mimetype : null;
  return { size, mimetype };
}

/* Read at most `maxBytes` of a stored object via an authenticated GET.
   The request is shaped EXACTLY like @supabase/storage-js 2.112.3 download():
     `${storageUrl}/object/{bucket}/{path}` with Authorization + apikey headers
   and NO Range header. This Storage stack rejects an authenticated Range GET on
   /object/... with HTTP 400 (storage-js's own exists() even treats 400/404 as
   "not found" on this endpoint), so we do NOT send Range. To still avoid
   pulling the whole object (~≤3 MB) into memory, the bounded stream reader
   copies only the first `maxBytes` bytes and immediately cancels the stream.
   Returns the bytes or null. */
export async function readStoredObjectPrefix(
  path: string,
  maxBytes: number
): Promise<Uint8Array | null> {
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const base = `${requireEnv("NEXT_PUBLIC_SUPABASE_URL")}/storage/v1`;
  /* Same relative-path form storage-js uses (_getFinalPath): bucket + path,
     no per-segment encoding (the quarantine path is server-generated ASCII). */
  const objectKey = `${RESOURCES_BUCKET}/${path}`;
  let res: Response;
  try {
    res = await fetch(`${base}/object/${objectKey}`, {
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
      },
      cache: "no-store",
    });
  } catch (err) {
    /* Diagnostic only — same null return as before. */
    logger.warn("finalize: storage range-read transport failed", {
      step: "range-read",
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  if (!res.ok || !res.body) {
    /* Diagnostic only — same null return as before. */
    logger.warn("finalize: storage range-read rejected", {
      step: "range-read",
      status: res.status,
      ok: res.ok,
    });
    return null;
  }

  const reader = res.body.getReader();
  const out = new Uint8Array(maxBytes);
  let filled = 0;
  try {
    while (filled < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.byteLength, maxBytes - filled);
      out.set(value.subarray(0, take), filled);
      filled += take;
    }
  } finally {
    /* Stream teardown must not block the publish path: production data proved
       `await reader.cancel()` can stall for seconds. Initiate cancellation
       without awaiting it, and swallow any rejection so an unhandled-rejection
       is never emitted. Bounded-read behavior and the maxBytes bound are
       unchanged. */
    void reader.cancel().catch(() => {
      /* best-effort teardown — never throw on the publish path */
    });
  }
  return filled > 0 ? out.subarray(0, filled) : null;
}

async function safeRemove(path: string): Promise<void> {
  if (!path) return;
  try {
    await removeResource(path);
  } catch {
    /* best-effort: orphan sweep (RESOURCE_CLEANUP_SECRET) can reclaim it */
  }
}

/* Finalize a direct upload: verify the quarantine object is the caller's own,
   validate the actual stored bytes (size + format magic bytes against the
   declared type), move it to the canonical summaries/exams path, and clean up
   the quarantine object on any failure so no untrusted object is ever
   reachable. Returns the final path AND the detected MIME type that the
   metadata RPC should store. */
export async function finalizeStoredUpload(input: {
  quarantinePath: string;
  userId: string;
  kind: "summary" | "exam";
}): Promise<
  | { ok: true; finalPath: string; size: number; mimeType: string }
  | { ok: false; error: "not_found" | "empty" | "too_large" | "invalid_type" | "move_failed" }
> {
  /* Diagnostic pacing log. NEVER log the quarantine path, the user id, signed
     URLs, tokens, or credentials — only kind + safe numeric/boolean fields. */
  logger.info("finalize upload: begin", { kind: input.kind });

  /* Only ever finalize an object the current user was issued a token for. */
  if (!input.quarantinePath.startsWith(`${QUARANTINE_PREFIX}${input.userId}/`)) {
    await safeRemove(input.quarantinePath);
    logger.warn("finalize failed: quarantine path mismatch", {
      step: "prefix",
      kind: input.kind,
    });
    return { ok: false, error: "invalid_type" };
  }

  const info = await getStoredObjectInfo(input.quarantinePath);
  if (!info) {
    await safeRemove(input.quarantinePath);
    logger.warn("finalize failed: object info unavailable", {
      step: "info",
      kind: input.kind,
      objectExists: false,
    });
    return { ok: false, error: "not_found" };
  }
  if (info.size <= 0) {
    await safeRemove(input.quarantinePath);
    logger.warn("finalize failed: empty object", {
      step: "info",
      kind: input.kind,
      objectExists: true,
      size: info.size,
    });
    return { ok: false, error: "empty" };
  }
  if (info.size > MAX_UPLOAD_BYTES) {
    await safeRemove(input.quarantinePath);
    logger.warn("finalize failed: object over size cap", {
      step: "info",
      kind: input.kind,
      objectExists: true,
      size: info.size,
      maxBytes: MAX_UPLOAD_BYTES,
    });
    return { ok: false, error: "too_large" };
  }

  const header = await readStoredObjectPrefix(input.quarantinePath, CHECK_HEADER_BYTES);
  if (!header) {
    await safeRemove(input.quarantinePath);
    logger.warn("finalize failed: header unreadable", {
      step: "range-read",
      kind: input.kind,
      objectExists: true,
      size: info.size,
    });
    return { ok: false, error: "invalid_type" };
  }

  /* The quarantine path's extension mirrors the DECLARED allowlisted MIME (set
     by upload-auth), so the declared type can be recovered from the path. The
     actual bytes are then matched against it — a renamed/mislabeled file whose
     signature disagrees with the declared type is rejected here. */
  const dot = input.quarantinePath.lastIndexOf(".");
  const declaredMime =
    dot >= 0 ? mimeFromExtension(input.quarantinePath.slice(dot + 1)) : undefined;
  const resolved = declaredMime
    ? resolveUploadFormat(declaredMime, header)
    : { ok: false as const, error: "invalid_type" as const };
  if (!resolved.ok) {
    await safeRemove(input.quarantinePath);
    logger.warn("finalize failed: format signature mismatch with declared type", {
      step: "magic-bytes",
      kind: input.kind,
      objectExists: true,
      size: info.size,
    });
    return { ok: false, error: "invalid_type" };
  }

  const finalPath =
    input.kind === "exam"
      ? examStoragePath(resolved.mimeType)
      : summaryStoragePath(resolved.mimeType);

  const admin = createAdminClient();
  const { error: moveError } = await admin.storage
    .from(RESOURCES_BUCKET)
    .move(input.quarantinePath, finalPath);
  if (moveError) {
    await safeRemove(input.quarantinePath);
    /* Redact any quarantine-path segment that a storage error message echoes. */
    const message = (moveError.message ?? "")
      .replace(/[^\s]*quarantine[^\s]*/gi, "[redacted]")
      .slice(0, 300);
    logger.warn("finalize failed: move", {
      step: "move",
      kind: input.kind,
      objectExists: true,
      size: info.size,
      message,
    });
    return { ok: false, error: "move_failed" };
  }

  /* Finalization succeeded — the caller issues the metadata RPC next. */
  logger.info("finalize ok: object validated and moved; metadata RPC next", {
    step: "move",
    kind: input.kind,
    size: info.size,
  });
  return { ok: true, finalPath, size: info.size, mimeType: resolved.mimeType };
}

/* Generate a short-lived signed URL for a stored object.
   Students only ever receive this URL (never the bytes). */
export async function createSignedResourceUrl(
  path: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(RESOURCES_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/* Remove a stored object during cleanup (e.g. after a DB write fails, or when
   a resource is soft-deleted). Best-effort — callers decide how to treat a
   failure. */
export async function removeResource(path: string): Promise<void> {
  if (!path) return;
  const admin = createAdminClient();
  const { error } = await admin.storage.from(RESOURCES_BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}
