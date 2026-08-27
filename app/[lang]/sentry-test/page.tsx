"use client";

import { useEffect } from "react";

/* ⚠️ TEMPORARY P1-1 PRODUCTION TEST — DO NOT SHIP.

   This route exists ONLY to verify that the deployed Sentry integration
   captures a client-side error and that the P0 error boundary still displays
   the safe generic UI.

   Behavior: after mount, it deliberately throws a sentinel Error. The nearest
   boundary (app/[lang]/error.tsx) renders the safe generic message and routes
   the exception through `captureBoundaryError` (fail-open, redacted).

   The sentinel message, path label, and digest are the ONLY data sent. No
   Supabase/auth/cookies/storage/env/DB access, no console logging, no PII, and
   no user-supplied context is involved.

   Remove this route (and ONLY this route) after the production test passes and
   clean up is approved.
*/

export default function SentryTestPage() {
  useEffect(() => {
    /* Sentinel thrown after mount. Deliberately not caught here so it
       propagates to the [lang] error boundary above. */
    throw new Error("P1_SENTRY_CLIENT_TEST_SENTINEL");
  }, []);

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-4 text-center"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
        Test
      </p>
      <h1 className="mt-4 text-3xl font-semibold text-foreground">
        Sentry client test
      </h1>
    </main>
  );
}