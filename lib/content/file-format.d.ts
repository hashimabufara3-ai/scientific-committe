/* Ambient type declarations for lib/content/file-format.mjs (a plain-JS ESM
   module). Resolved by TS via "moduleResolution": "bundler" when consumers
   import "./file-format". Keep in sync with the exports in the .mjs. */

export type UploadFormat = {
  mimeType: string;
  extension: string;
};

export const MAX_UPLOAD_BYTES: number;
export const ALLOWED_FORMATS: Record<string, string>;
export const FILE_EXTENSION_MIMES: Record<string, string>;
export const CHECK_HEADER_BYTES: number;
export function allowedExtension(mime: string): string | undefined;
export function mimeFromExtension(extension: string): string | undefined;
export function mimeFromFileName(fileName: string): string | undefined;
export function detectUploadFormat(bytes: Uint8Array): UploadFormat | null;
export function resolveUploadFormat(
  declaredMime: string,
  bytes: Uint8Array
):
  | { ok: true; mimeType: string; extension: string }
  | { ok: false; error: "invalid_type" };
export function validateFileUpload(
  mime: string,
  size: number
): { ok: true; extension: string } | { ok: false; error: "too_large" | "invalid_type" };