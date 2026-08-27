"use client";

/* TEMPORARY SECURITY TESTING CODE — DO NOT SHIP. REMOVE AFTER TESTING.
   This page exists ONLY to trigger the existing app/[lang]/error.tsx boundary
   in the deployed production environment. It intentionally throws a harmless
   error after mount (in useEffect) so the client-side React error boundary is
   exercised exactly as in production.

   It never displays the error itself, never logs it, and accesses NO Supabase,
   authentication, cookies, environment variables, database, user data, or
   secrets. The thrown message is a benign sentinel used only to verify the
   error is NOT leaked to the user. */

import { useEffect } from "react";

export default function SecurityTestErrorPage() {
  useEffect(() => {
    throw new Error("P0_SECURITY_TEST_SENTINEL");
  }, []);

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-4 py-28 text-center sm:px-6"
    >
      <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
        Security test route
      </h1>
      <p className="mt-6 max-w-md text-base leading-relaxed text-muted">
        Temporary P0 error boundary test page.
      </p>
    </main>
  );
}
