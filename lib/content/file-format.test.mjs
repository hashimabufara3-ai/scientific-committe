/*
   Node test suite for lib/content/file-format.mjs — the pure signature /
   extension validation functions shared by server uploads (storage.ts), the
   upload-authorization route, and the client pre-checks.

   Run with:
     node --test lib/content/file-format.test.mjs
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  detectUploadFormat,
  resolveUploadFormat,
  validateFileUpload,
  MAX_UPLOAD_BYTES,
  ALLOWED_FORMATS,
} from "./file-format.mjs";

const PDF = Buffer.from("%PDF-1.7\n...");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);
const WEBP = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

test("PDF detected by magic bytes regardless of declared MIME", () => {
  assert.deepEqual(detectUploadFormat(PDF), {
    mimeType: "application/pdf",
    extension: "pdf",
  });
  assert.equal(resolveUploadFormat("text/plain", PDF).ok, false);
  assert.equal(
    resolveUploadFormat("application/pdf", PDF).ok,
    true,
    "declared MIME must be on the allowlist AND match the bytes"
  );
});

test("raster image magic bytes resolve to an image by content", () => {
  const cases = [
    [PNG, "image/png", "png"],
    [JPEG, "image/jpeg", "jpg"],
    [GIF, "image/gif", "gif"],
    [WEBP, "image/webp", "webp"],
  ];
  for (const [bytes, mime, ext] of cases) {
    assert.deepEqual(detectUploadFormat(bytes), { mimeType: mime, extension: ext });
  }
  for (const [bytes, mime] of cases) {
    const result = resolveUploadFormat(mime, bytes);
    assert.equal(result.ok, true, `${mime} agrees with its magic bytes`);
  }
});

test("mislabeled files are rejected (declared MIME does not match the bytes)", () => {
  assert.equal(resolveUploadFormat("image/png", PDF).ok, false);
  assert.equal(resolveUploadFormat("image/png", JPEG).ok, false);
  assert.equal(resolveUploadFormat("application/pdf", PNG).ok, false);
  assert.equal(resolveUploadFormat("image/jpeg", WEBP).ok, false);
});

test("empty and arbitrary bytes never resolve to an allowed format", () => {
  assert.equal(detectUploadFormat(Buffer.alloc(0)), null);
  assert.equal(detectUploadFormat(Buffer.from("hello world")), null);
  assert.equal(resolveUploadFormat("application/pdf", Buffer.alloc(0)).ok, false);
  assert.equal(resolveUploadFormat("image/png", Buffer.from("not a png")).ok, false);
});

test("validateFileUpload caps size and allowlists the declared MIME", () => {
  assert.equal(validateFileUpload("application/pdf", MAX_UPLOAD_BYTES).ok, true);
  assert.equal(validateFileUpload("image/jpeg", 100).ok, true);
  assert.equal(validateFileUpload("image/svg+xml", 100).ok, false);
  assert.equal(validateFileUpload("application/pdf", 0).error, "too_large");
  assert.equal(
    validateFileUpload("application/pdf", MAX_UPLOAD_BYTES + 1).error,
    "too_large"
  );
});

test("ALLOWED_FORMATS covers the blocklist intent (SVG excluded)", () => {
  assert.deepEqual(Object.keys(ALLOWED_FORMATS).sort(), [
    "application/pdf",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);
  assert.equal(ALLOWED_FORMATS["image/svg+xml"], undefined, "SVG must stay rejected");
});