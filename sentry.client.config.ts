/* Sentry error tracking browser (client) configuration (P1-1A).

   This is the browser SDK init for client-side error capture.

   P1-1A scope: ERROR CAPTURE ONLY.
   - no browser tracing / Performance monitoring
   - no session replay
   - no profiling
   - sampleRate = 1 (errors are rare; capture all of them)

   DEV/PROD ISOLATION
   Initialization is skipped unless a DSN is configured, so local development
   never initializes or contacts the production Sentry project.

   SAFETY
   Every client event passes through `redactEvent` (beforeSend), which strips
   request headers, request bodies, and user identity, and scrubs any
   emails/JWTs/IPs/DB details before the event can leave the browser.
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

    // Explicitly disable Replay and tracing integrations.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // Final safety net before any event is sent from the browser.
    beforeSend: redactEvent,
  });
}
