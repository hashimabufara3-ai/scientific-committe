/*
   Node test suite for the pure browser TUS helpers in
   lib/content/tus-upload.ts.

   These assert the resumable-upload transport contract WITHOUT a browser or any
   production/hosted-Supabase access:
     - the TUS endpoint is derived from public config only (no hardcoded ref);
     - the signed upload token travels in the `x-signature` header;
     - the object path stays the server-issued quarantine path;
     - retry/chunk configuration exists for resumability.

   Run with:
     node --test lib/content/tus-upload.test.mjs
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTusUploadOptions,
  deriveStorageOrigin,
  isTusAuthError,
  resolveStorageTusEndpoint,
  TUS_CHUNK_SIZE,
  TUS_ENDPOINT_PATH,
  TUS_RESOURCES_BUCKET,
  TUS_RETRY_DELAYS,
} from "./tus-upload.ts";

test("deriveStorageOrigin maps the project API host to the dedicated Storage host", () => {
  assert.equal(
    deriveStorageOrigin("https://abcdefghijklmnopqrst.supabase.co"),
    "https://abcdefghijklmnopqrst.storage.supabase.co"
  );
  assert.equal(deriveStorageOrigin("https://x.supabase.co/"), "https://x.storage.supabase.co");
});

test("deriveStorageOrigin rejects non-Supabase and non-https inputs", () => {
  assert.equal(deriveStorageOrigin(undefined), null);
  assert.equal(deriveStorageOrigin(""), null);
  assert.equal(deriveStorageOrigin("http://x.supabase.co"), null);
  assert.equal(deriveStorageOrigin("https://example.com"), null);
  assert.equal(
    deriveStorageOrigin("https://x.storage.supabase.co"),
    null,
    "an already-storage host must not be rewritten"
  );
});

test("resolveStorageTusEndpoint derives the documented TUS endpoint without a hardcoded ref", () => {
  const endpoint = resolveStorageTusEndpoint({
    supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
  });
  assert.equal(
    endpoint,
    `https://abcdefghijklmnopqrst.storage.supabase.co${TUS_ENDPOINT_PATH}`
  );
  assert.equal(endpoint.includes("/storage/v1/upload/resumable"), true);
});

test("resolveStorageTusEndpoint prefers an explicit public Storage URL", () => {
  const endpoint = resolveStorageTusEndpoint({
    storageUrl: "https://explicit.storage.supabase.co",
    supabaseUrl: "https://derived.supabase.co",
  });
  assert.equal(endpoint, `https://explicit.storage.supabase.co${TUS_ENDPOINT_PATH}`);
});

test("resolveStorageTusEndpoint fails closed on missing/invalid config", () => {
  assert.equal(resolveStorageTusEndpoint({}), null);
  assert.equal(resolveStorageTusEndpoint({ supabaseUrl: "not a url" }), null);
  assert.equal(resolveStorageTusEndpoint({ supabaseUrl: "http://x.supabase.co" }), null);
});

test("buildTusUploadOptions sends the signed token via x-signature and keeps the server path", () => {
  const path = "quarantine/11111111-1111-1111-1111-111111111111/abc.pdf";
  const config = buildTusUploadOptions({
    endpoint: "https://x.storage.supabase.co/storage/v1/upload/resumable/sign",
    token: "signed-token-value",
    path,
    contentType: "application/pdf",
  });

  assert.equal(config.headers["x-signature"], "signed-token-value");
  assert.equal(config.metadata.objectName, path, "object path must stay server-issued");
  assert.equal(config.metadata.bucketName, TUS_RESOURCES_BUCKET);
  assert.equal(config.metadata.contentType, "application/pdf");
  assert.equal(config.endpoint.endsWith(TUS_ENDPOINT_PATH), true);
});

test("buildTusUploadOptions configures resumability (chunk size + retry + fingerprint cleanup)", () => {
  const config = buildTusUploadOptions({
    endpoint: "https://x.storage.supabase.co/storage/v1/upload/resumable/sign",
    token: "t",
    path: "quarantine/u/1.pdf",
    contentType: "application/pdf",
  });

  assert.equal(TUS_CHUNK_SIZE, 6 * 1024 * 1024, "Supabase TUS uses 6 MB chunks");
  assert.equal(config.chunkSize, TUS_CHUNK_SIZE);
  assert.ok(Array.isArray(config.retryDelays) && config.retryDelays.length > 0);
  assert.deepEqual(config.retryDelays, TUS_RETRY_DELAYS);
  assert.equal(config.removeFingerprintOnSuccess, true);
});

test("isTusAuthError only flags 401/403 so other failures are retried as network", () => {
  const withStatus = (status) => ({ originalResponse: { getStatus: () => status } });
  assert.equal(isTusAuthError(withStatus(401)), true);
  assert.equal(isTusAuthError(withStatus(403)), true);
  assert.equal(isTusAuthError(withStatus(500)), false);
  assert.equal(isTusAuthError(new Error("network")), false);
  assert.equal(isTusAuthError(undefined), false);
});
