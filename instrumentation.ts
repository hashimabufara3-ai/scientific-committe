/* Sentry instrumentation registration (P1-1A).

   Next.js 16 calls `register()` once when a server instance starts, and calls
   `onRequestError()` when the Next.js server captures a request error (server
   rendering, route handlers, server actions, proxy/middleware).

   P1-1A scope:
   - `register` loads the server SDK config (Node runtime only) so client-side
     hooks and the browser bundle server config are not double-initialized.
     The edge/proxy runtime is intentionally NOT instrumented in this first
     version (minimal, error-only foundation).
   - `onRequestError` reuses the SDK's `captureRequestError`, which funnels
     captured server errors through the same `beforeSend` redaction defined in
     `sentry.server.config.ts`, so no sensitive data can leave the server.
*/

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
