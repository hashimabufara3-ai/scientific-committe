/* Pure, dependency-free validation rules for contributor file uploads.

   This module defines WHAT formats are accepted and HOW to recognize them:
   the MIME/extension allowlist, the size cap, and the magic-byte signatures
   checked against the actual file bytes. It deliberately imports nothing from
   Node, Next.js or Supabase so the SAME module can run in the server actions,
   the upload-authorization route, the client UI, and the Node test runner.

   Validation stays AUTHORITATIVE on the server:
     - the declared MIME type must be on the allowlist AND must match the bytes;
     - a renamed or mislabeled file (an executable renamed to ".pdf", a text
       file renamed to ".jpg", arbitrary binary renamed to ".png", ...) is
       rejected because its signature matches no allowed format; and
     - byte-level detection never trusts the browser-reported type.
*/

/* Upload cap (3 MB), shared by the client hint and the server validation. */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

/* The ONLY allowed upload formats, mapped to the storage-key extension.
   New uploads are PDF plus common raster images. SVG is intentionally NOT
   allowed: an SVG served through the raw-object signed URLs carries script
   content and rendering it safely would require sanitization this
   architecture does not perform, so it is rejected rather than risk an
   XSS injection surface. */
export const ALLOWED_FORMATS = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/* Valid file-name extensions -> canonical MIME. Used only for best-effort
   client hints (never authoritative). "jpeg" is an alias of "jpg". */
export const FILE_EXTENSION_MIMES = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/* Header bytes the server re-reads before validating a stored object. Covers
   every allowed signature: all image signatures live at byte 0 and the PDF
   marker (which may legally be preceded by whitespace) is searched within this
   window. */
export const CHECK_HEADER_BYTES = 1024;

/* ---- Allowlist lookups ---------------------------------------------------- */

export function allowedExtension(mime) {
  return ALLOWED_FORMATS[mime];
}

/* Inverse of allowedExtension(): storage-key extension -> canonical MIME.
   The quarantine object path is the only declared-type signal a stored file
   itself carries, so finalizeStoredUpload derives the declared MIME from the
   object's extension this way. */
export function mimeFromExtension(extension) {
  for (const [mime, ext] of Object.entries(ALLOWED_FORMATS)) {
    if (ext === extension) return mime;
  }
  return undefined;
}

/* Best-effort MIME inference from a FILE NAME (extension only) — used as a
   client-side fallback when the browser reports an empty type. Never
   authoritative; the server validates declared MIME + bytes. */
export function mimeFromFileName(fileName) {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return undefined;
  return FILE_EXTENSION_MIMES[fileName.slice(dot + 1).toLowerCase()];
}

/* ---- Magic-byte signatures ------------------------------------------------ */

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF_SIGNATURES = [
  [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // "GIF87a"
  [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // "GIF89a"
];
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50]; // "WEBP"

function startsWithBytes(bytes, signature) {
  if (bytes.byteLength < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

/* A PDF's header may legally be preceded by whitespace, so "%PDF-" is searched
   within the first CHECK_HEADER_BYTES rather than only at byte 0. */
function containsPdfSignature(bytes) {
  if (bytes.byteLength < PDF_SIGNATURE.length) return false;
  const limit = Math.min(bytes.byteLength, CHECK_HEADER_BYTES);
  for (let i = 0; i <= limit - PDF_SIGNATURE.length; i += 1) {
    if (startsWithBytes(bytes.subarray(i, i + PDF_SIGNATURE.length), PDF_SIGNATURE)) {
      return true;
    }
  }
  return false;
}

/* ---- Byte-level detection ------------------------------------------------- */

/* Detect the ACTUAL format of an uploaded file from its first bytes. Returns
   the canonical { mimeType, extension } pair, or null when the bytes match no
   allowed format (arbitrary binary, renamed executables, text, unsupported
   images, empty files, ...). */
export function detectUploadFormat(bytes) {
  if (!bytes || bytes.byteLength === 0) return null;
  if (startsWithBytes(bytes, JPEG_SIGNATURE)) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (startsWithBytes(bytes, PNG_SIGNATURE)) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (GIF_SIGNATURES.some((signature) => startsWithBytes(bytes, signature))) {
    return { mimeType: "image/gif", extension: "gif" };
  }
  if (
    bytes.byteLength >= 12 &&
    startsWithBytes(bytes, RIFF_SIGNATURE) &&
    startsWithBytes(bytes.subarray(8, 12), WEBP_SIGNATURE)
  ) {
    return { mimeType: "image/webp", extension: "webp" };
  }
  if (containsPdfSignature(bytes)) {
    return { mimeType: "application/pdf", extension: "pdf" };
  }
  return null;
}

/* ---- Combined validation -------------------------------------------------- */

/* End-to-end resolution of an upload from the DECLARED (client-provided) MIME
   and the actual stored BYTES. Both must agree:
     - the declared MIME must be an allowed type, and
     - the detected bytes must carry the matching magic-byte signature.
   A mismatch (declared "image/jpeg" but the bytes are a PNG or an executable)
   is rejected so mislabeled/renamed files never reach a canonical path. */
export function resolveUploadFormat(declaredMime, bytes) {
  const declaredExtension = allowedExtension(declaredMime);
  if (!declaredExtension) return { ok: false, error: "invalid_type" };
  const detected = detectUploadFormat(bytes);
  if (!detected || detected.extension !== declaredExtension) {
    return { ok: false, error: "invalid_type" };
  }
  return { ok: true, mimeType: detected.mimeType, extension: detected.extension };
}

/* Early metadata check used by the upload-authorization route BEFORE a signed
   upload URL is issued: declared MIME must be on the allowlist and the size
   must be a non-zero value within the cap. Purely advisory compared to
   resolveUploadFormat() — the stored bytes are still re-read and validated
   during finalization, and this reject path exists only to avoid minting URLs
   for obviously-invalid uploads. */
export function validateFileUpload(mime, size) {
  if (size === 0 || size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "too_large" };
  }
  const extension = allowedExtension(mime);
  if (!extension) {
    return { ok: false, error: "invalid_type" };
  }
  return { ok: true, extension };
}