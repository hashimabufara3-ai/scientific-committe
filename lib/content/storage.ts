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

/* Allowed upload MIME type + the file extension to use for the storage key.
   NEW uploads are PDF-only. Existing files of other previously-allowed types
   (PNG/JPEG/WebP/TXT) are untouched: they keep their stored metadata/path and
   continue to be served by the read/view/download code paths whose rendering
   is generic over the stored file type. */
const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
};

/* Preserve the prototype's cap unless the UI shows a need to change it. */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

/* The PDF file signature "%PDF-" (0x25 0x50 0x44 0x46 0x2D). The PDF spec
   allows leading whitespace before the header, so the signature is searched
   within the first 1024 bytes of the file rather than only at byte 0. */
const PDF_HEADER_MAX = 1024;
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // % P D F -

/* Verifies the first bytes of an uploaded file really carry a PDF signature,
   independent of the browser-reported MIME type (which is client-controlled and
   trivially spoofable). Reads only up to 1 KB of header, never the whole file.
   Returns false for empty/short files and for any file without "%PDF-". */
export function isPdfSignature(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length < PDF_SIGNATURE.length) return false;
  const limit = Math.min(bytes.length, PDF_HEADER_MAX);
  outer: for (let i = 0; i <= limit - PDF_SIGNATURE.length; i++) {
    for (let j = 0; j < PDF_SIGNATURE.length; j++) {
      if (bytes[i + j] !== PDF_SIGNATURE[j]) continue outer;
    }
    return true;
  }
  return false;
}

/* Validate a raw file upload: MIME must be on the allowlist and size must be
   within MAX_UPLOAD_BYTES. Rejects images whose browser-reported type is
   generic (e.g. an empty string or "application/octet-stream") as well, so the
   allowlist is always authoritative for the declared type. The PDF magic-byte
   authenticity check (isPdfSignature) is applied separately by the upload route
   because it needs a byte slice of the file. Returns an error code for the
   client. */
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

/* Upload validated bytes to Storage. Accepts the raw browser File/Blob (from
   the multipart route handler) or an explicit ArrayBuffer, and passes it
   straight to the Storage client so the bytes are not copied through an extra
   ArrayBuffer round-trip on the server.
   Throws on failure — the caller should treat a thrown error as "upload
   failed; do not create a metadata row". */
export async function uploadResource(
  path: string,
  body: Blob | ArrayBuffer,
  mime: string
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(RESOURCES_BUCKET)
    .upload(path, body, { contentType: mime, upsert: false });
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
