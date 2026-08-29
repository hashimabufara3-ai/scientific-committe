import { createAdminClient } from "../auth/supabase-server";

/* Server-only Supabase Storage helpers for the Resources/Summaries section.

   The bucket is PRIVATE ("resources"). There are no client upload policies, so
   every write goes through these functions using the service-role client
   (server-only, never exposed to the browser). Reading is done via
   short-lived signed URLs so PDF bytes never land in RSC payloads, React state
   or localStorage.

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

/* Allowed upload MIME types + the file extension to use for the storage key.
   Only genuinely renderable/downloadable documents are accepted. */
const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "text/plain": "txt",
};

/* Preserve the prototype's 2 MB cap unless the UI shows a need to change it. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export function isValidUploadMime(mime: string): boolean {
  return mime in ALLOWED_TYPES;
}

/* Validate a raw file upload: MIME must be on the allowlist and size must be
   within MAX_UPLOAD_BYTES. Rejects images whose browser-reported type is
   generic (e.g. an empty string or "application/octet-stream") as well, so the
   allowlist is always authoritative. Returns an error code for the client. */
export function validateFileUpload(
  mime: string,
  size: number
): { ok: true; extension: string } | { ok: false; error: string } {
  if (size === 0 || size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "too_large" };
  }
  const extension = storageExtension(mime);
  if (!extension) {
    return { ok: false, error: "invalid_type" };
  }
  return { ok: true, extension };
}

export function storageExtension(mime: string): string | undefined {
  return ALLOWED_TYPES[mime];
}

function uuid(): string {
  return crypto.randomUUID();
}

/* Generate a safe object path for a summary upload. */
export function summaryStoragePath(mime: string): string {
  const ext = storageExtension(mime) ?? "bin";
  return `summaries/${uuid()}.${ext}`;
}

/* Generate a safe object path for an exam file upload. */
export function examStoragePath(mime: string): string {
  const ext = storageExtension(mime) ?? "bin";
  return `exams/${uuid()}.${ext}`;
}

/* Upload validated bytes to Storage. Returns the object path on success.
   Throws on failure — the caller should treat a thrown error as "upload
   failed; do not create a metadata row". */
export async function uploadResource(
  path: string,
  bytes: ArrayBuffer,
  mime: string
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(RESOURCES_BUCKET)
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (error) throw new Error(error.message);
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
