/* Sentry error tracking server configuration (P1-1A).

   This is the Node.js runtime SDK init. It is loaded from
   `instrumentation.ts` `register()` so it initializes once when the Next.js
   server process starts.

   P1-1A scope: ERROR CAPTURE ONLY.
   - tracesSampleRate = 0 (no tracing / performance spans)
   - no session replay, no profiling
   - sampleRate = 1 (errors are rare; capture all of them)

   DEV/PROD ISOLATION
   Initialization is skipped unless a DSN is configured, so local development
   never initializes or contacts the production Sentry project. Set
   NEXT_PUBLIC_SENTRY_DSN (and optionally SENTRY_ENVIRONMENT) in Render only.

   SAFETY
   Every event passes through `redactEvent` (beforeSend) which strips
   sensitive headers, cookies, request bodies, query strings, and user
   identity, and scrubs emails/JWTs/IPs/DB details before anything can leave
   the server.
*/

import * as Sentry from "@sentry/nextjs";
import { redactEvent } from "./lib/security/sentry";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? "production",

    // Error-only capture.
    tracesSampleRate: 0,
    sampleRate: 1,

    // Final safety net before any event is sent.
    beforeSend: redactEvent,

    // No release/trace metadata is required for error-only capture.
  });
}
