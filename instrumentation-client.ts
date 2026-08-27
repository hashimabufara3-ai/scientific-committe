/* Client-side Sentry instrumentation (P1-1A).

   Next.js 16 loads this file on the CLIENT before React hydration (parallel
   to `instrumentation.ts` on the server). Its only job is to import the
   browser SDK config so the client SDK initializes before any boundary
   capture can run.

   Without this file the client SDK would never initialize: `withSentryConfig`
   (webpack-only in this Turbopack build) is intentionally not used, so the
   `sentry.client.config.ts` side-effect must be wired in explicitly.

   The config itself is DSN-gated, error-only, and safe (see its comments).
   If it throws for any reason, error tracking is simply unavailable — the
   application is unaffected (import failure never breaks rendering).
*/

import "./sentry.client.config";