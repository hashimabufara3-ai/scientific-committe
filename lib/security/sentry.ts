/* Centralized, safe error-capture interface for the application (P1-1A).

   This is the ONLY place application code should import `@sentry/nextjs`
   from. It provides:

     - `isSentryEnabled()`     runtime check (env-gated, client-safe)
     - `captureBoundaryError()` fail-open capture for the P0 error boundaries
     - `captureActionError()`  safe capture for server actions / route handlers
     - `redactEvent`           the beforeSend normalizer shared by server and
                               client SDK configurations

   Security contract:
   - Application code passes structured, SAFE inputs (an action/component name
     and a sanitized message). It must never pass raw inputs: passwords,
     tokens, emails, usernames, IPs, or raw Supabase/PostgreSQL error objects.
   - `redactEvent` is the second line of defense: it strips headers, cookies,
     request bodies, query strings, and user identity, and scrubs any remaining
     PII/token-like text before an event can leave the application.

   All captures are fail-open: if the SDK is disabled or capture throws, the
   application continues normally. No capture ever affects rendering or an
   action's success/error result.
*/

import * as Sentry from "@sentry/nextjs";
import type { ErrorEvent } from "@sentry/nextjs";
import { normalizeEvent, scrubErrorMessage } from "./redact";
import type { EventLike } from "./redact";

/* Runtime toggle. Production-only by default; enables sentry only when a DSN
   is configured so local development never contacts a production project. */
export function isSentryEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) return true;
  return false;
}

/* beforeSend normalizer shared by sentry.server.config.ts and
   sentry.client.config.ts. Acts as the final safety net. Uses Sentry's
   ErrorEvent type (the shape beforeSend receives) and hands it to the pure,
   dependency-free normalizer in redact.ts via an EventLike bridge. */
export function redactEvent(event: ErrorEvent): ErrorEvent {
  return normalizeEvent(event as unknown as EventLike) as unknown as ErrorEvent;
}

/* Context that may be attached to an event. Only explicit, safe fields are
   permitted; never pass raw data here. */
export type CaptureContext = {
  action?: string;
  component?: string;
  route?: string;
  method?: string;
  digest?: string;
  /* Safe application-level error code (e.g. a Supabase/PG error code like
     "PGRST116", or a status). Never a message/details/hint free-text value. */
  code?: string | number;
};

/* Fail-open wrapper that never breaks the caller, even if the SDK misbehaves
   or is disabled. */
function safeCapture(fn: () => void): void {
  if (!isSentryEnabled()) return;
  try {
    fn();
  } catch {
    /* Tracking must never affect the application. */
  }
}

/* Capture for the P0 error boundaries (client). Receives the boundary's
   `error` and a safe source label. Layer 2 (`beforeSend` → `normalizeEvent`)
   is the safety net here: it scrubs exception message text and stack frames
   and strips user/request fields before anything can leave the browser. */
export function captureBoundaryError(
  error: unknown,
  context: CaptureContext
): void {
  safeCapture(() => {
    const err =
      error instanceof Error ? error : new Error("Unknown boundary error");
    Sentry.captureException(err, {
      tags: { capture: "boundary" },
      extra: {
        action: context.action,
        component: context.component,
        route: context.route,
        digest: context.digest,
        code: context.code,
      },
    });
  });
}

/* Safe capture for server actions and route handlers.
   LAYER 1 contract (strict): the raw `error` object is NEVER forwarded to
   Sentry — only its `.name` may be reused as the safe error type. The event
   message is always the scrubbed `message` the caller provides (a short,
   non-sensitive label). This guarantees raw Supabase/PG `.message`,
   `.details`, `.hint`, or SQL never enter an event from this path, even if a
   caller accidentally passes a raw database error object. */
export function captureActionError(
  error: unknown,
  message: string,
  context: CaptureContext
): void {
  safeCapture(() => {
    const safeName =
      error instanceof Error && error.name ? error.name : "Error";
    const err = new Error(scrubErrorMessage(message) || "Unknown action error");
    err.name = safeName;
    Sentry.captureException(err, {
      tags: { capture: "action" },
      extra: {
        message: scrubErrorMessage(message),
        action: context.action,
        component: context.component,
        route: context.route,
        method: context.method,
        digest: context.digest,
        code: context.code,
      },
    });
  });
}

/* Optional: capture a non-fatal message (low severity informational). Attach
   safe `context` as extra only; no raw values are ever sent. */
export function captureInfo(
  message: string,
  context: CaptureContext
): void {
  safeCapture(() => {
    Sentry.captureMessage(scrubErrorMessage(message) || "Info", {
      level: "info",
      tags: { capture: "info" },
      extra: {
        action: context.action,
        component: context.component,
        route: context.route,
      },
    });
  });
}

/* Re-export the SDK capture primitive so future modules can opt in without
   importing @sentry/nextjs directly. Use with caution: pass already-sanitized
   values only. */
export const captureException = Sentry.captureException;
export const captureMessage = Sentry.captureMessage;
export const setTag = Sentry.setTag;
export const setContext = Sentry.setContext;
export const addBreadcrumb = Sentry.addBreadcrumb;
